/**
 * The spam check holds selling and lets people through, in any language. The
 * spam below has the shapes support@ received Feb 12 to Oct 23 2026 (written
 * fresh here: no real sender or message is copied). The real messages are the
 * kinds of thing people write to us, several of them not in English.
 *
 * Measured on all 130 stored messages before it shipped: the rules alone held
 * 23 spam messages and no real person's message; every real message scored 0.
 */
import { describe, expect, it } from "vitest";

import {
  AI_SYSTEM_PROMPT,
  aiUserPrompt,
  borrowedBrand,
  HOLD_AT,
  isAccountSender,
  isNoticeSender,
  linkHosts,
  readAiAnswer,
  ruleScore,
  senderKey,
  senderKeys,
  verdictFor,
  type MailForCheck,
} from "./spamCheck";

const NONE = { allowed: false, blocked: false, answersUs: false };

const SPAM: Array<[string, MailForCheck]> = [
  [
    "a link-selling pitch with a messenger handle",
    {
      from: "outreach@growthlinks.example",
      subject: "Guest posts on high-DR sites",
      text: "We offer do-follow backlinks and guest posts. Message us on WhatsApp for the price list.",
    },
  ],
  [
    "a launch-directory pitch from a bulk sender",
    {
      from: "hello@launchlist.example",
      subject: "Get featured on our curated directory",
      text: "List your product on our curated directory and get featured on the front page. https://a.example https://b.example https://c.example",
      listUnsubscribe: "<mailto:unsub@launchlist.example>",
    },
  ],
  [
    "a fake domain renewal with replies elsewhere",
    {
      from: "billing@domain-notice.example",
      subject: "RENEWAL NOTICE: PERMTRACKER.APP",
      text: "Your domain permtracker.app is about to expire. Renew now to keep your listing.",
      replyTo: "pay@other-host.example",
    },
  ],
  [
    "a lead list for sale",
    {
      from: "data@leads.example",
      subject: "Attendee list",
      text: "We have the verified attendee list for the expo, 12,000 contacts, leads for sale at a discount.",
    },
  ],
  [
    "a link typed into the name",
    {
      from: "noreply@mailer.example",
      fromName: "Claim your prize at win-now.xyz",
      subject: "You have won",
      text: "Click to claim.",
    },
  ],
  [
    "an upstream spam flag and a loan pitch",
    {
      from: "offers@fast-funds.example",
      subject: "Business funding",
      text: "Pre-approved loan for your company. Credit facility up to $500,000.",
      spamFlag: "YES",
    },
  ],
  [
    "a Japanese fake delivery notice with a messenger push",
    {
      from: "system@mail-host.example",
      subject: "メール配信エラー",
      text: "お客様のメールは配信されませんでした。詳細は Telegram でご確認ください。",
    },
  ],
  [
    "a contract to review from a domain borrowing a brand's name, quoting our address",
    {
      from: "service@adobesharedteam.example",
      fromName: "Adobe Sign",
      subject: "permtracker.app Service support@permtracker.app Review Contract Agreement",
      text: "A contract agreement was shared with you for review.",
    },
  ],
  [
    "an inheritance scam that moves to a messenger",
    {
      from: "barrister@chambers-office.example",
      subject: "Unclaimed funds",
      text: "You are the sole beneficiary of the estate of my late client. Write to me on WhatsApp to claim the inheritance.",
    },
  ],
];

const REAL: Array<[string, MailForCheck]> = [
  [
    "a question about a pending case",
    {
      from: "maria.lopez@gmail.com",
      fromName: "Maria Lopez",
      subject: "My PERM case shows analyst review",
      text: "Hi, my case G-100-25350-123456 has said analyst review since March. Is that normal? Thank you.",
    },
  ],
  [
    "a removal request that names contact data",
    {
      from: "a.person@example.org",
      subject: "Please remove my name",
      text: "Please remove my name and contact data from your employer page. It is a small family business.",
    },
  ],
  [
    "a reply to us",
    {
      from: "owner@smallfirm.example",
      subject: "Re: your note",
      text: "Thanks for writing back. We will try the alert.",
      thread: "<abc@permtracker.app>",
    },
  ],
  ["Chinese", { from: "wang@qq.com", subject: "关于我的PERM案件", text: "您好，我的案件已经等了十个月，请问什么时候会有结果？谢谢。" }],
  ["Korean", { from: "kim@naver.com", subject: "PERM 진행 상황 문의", text: "안녕하세요. 제 케이스가 아직 진행 중인데 언제쯤 결과가 나올까요?" }],
  ["Vietnamese", { from: "nguyen@gmail.com", subject: "Hỏi về hồ sơ PERM", text: "Xin chào, hồ sơ của tôi nộp tháng 12 năm 2025. Khi nào có kết quả ạ?" }],
  ["Spanish", { from: "jose@hotmail.com", subject: "Pregunta sobre mi caso", text: "Hola, ¿cuánto tarda el Departamento de Trabajo en decidir un caso PERM?" }],
  [
    "a person at Adobe itself",
    { from: "j.doe@adobe.com", subject: "H-1B data question", text: "Do you have last year's LCA counts by city?" },
  ],
  [
    "an attorney sending an agreement to review",
    {
      from: "partner@smalllawfirm.example",
      subject: "Data license agreement for review",
      text: "Please review the attached agreement for the data license we discussed.",
    },
  ],
  [
    "a person who names our address because a message bounced",
    { from: "r.khan@gmail.com", subject: "My mail to support@permtracker.app bounced", text: "Is this the right address?" },
  ],
  [
    "a members' digest that quotes our own subject, read as spam by the AI",
    {
      from: "noreply@members-digest.example",
      subject: "Your digest: 2 new requests",
      text:
        "Your topics: employment-based green cards, PERM labor certification, H-1B visas and the H-1B lottery, the " +
        "visa bulletin, Department of Labor and USCIS processing times.",
      extra: [{ weight: 2, why: "Cloudflare's AI read it as spam" }],
    },
  ],
  [
    "a person picked in the H-1B lottery",
    {
      from: "arjun.s@gmail.com",
      subject: "After the lottery",
      text: "I won the H-1B lottery this year. If you won the lottery too, what happens next with the LCA?",
    },
  ],
  [
    "an attorney writing about a beneficiary and the wage",
    {
      from: "paralegal@smalllawfirm.example",
      subject: "Beneficiary's wage",
      text: "The beneficiary's offered wage is $95,000 and the employer has the funds to pay it. Does the estimate count the audit?",
    },
  ],
  [
    "a person asking about the diversity visa lottery, who writes you won't",
    {
      from: "selam@yahoo.com",
      subject: "DV lottery and the bulletin",
      text: "My sister was selected in the diversity visa lottery. If the date isn't current you won't be scheduled, right?",
    },
  ],
  [
    "a person whose code didn't arrive",
    {
      from: "late.signup@gmail.com",
      subject: "Verification code",
      text: "I tried to sign up but the verification code never arrived. Can you help?",
    },
  ],
];

describe("the rules", () => {
  it.each(SPAM)("hold %s", (_label, mail) => {
    const v = verdictFor(mail, NONE);
    expect(v.action).toBe("hold");
    expect(v.score).toBeGreaterThanOrEqual(HOLD_AT);
    expect(v.reasons.length).toBeGreaterThan(0);
  });

  it.each(REAL)("let through %s", (_label, mail) => {
    expect(verdictFor(mail, NONE).action).toBe("forward");
  });

  it("count a pitch at 2, never enough to hold alone", () => {
    const one = ruleScore({ from: "x@y.example", subject: "Website redesign", text: "We do web design." });
    expect(one.score).toBe(2);
    expect(verdictFor({ from: "x@y.example", subject: "Website redesign", text: "We do web design." }, NONE).action).toBe(
      "forward",
    );
  });

  it("count at most three pitches", () => {
    const text = "SEO backlinks, web design, loan offers, wholesale factory quotation, lottery winnings";
    expect(ruleScore({ from: "x@y.example", subject: "Hi", text }).score).toBe(2 + 1 + 1);
  });
});

// This site's own subject uses two of the scam's words every day. A service's digest quoting "the H-1B lottery" was
// held on Nov 10 2026, and "you won't" matched "you won".
describe("the inheritance and prize rule", () => {
  const SCAM = "an inheritance or prize scam";
  const reasons = (text: string) => ruleScore({ from: "x@y.example", subject: "Hello", text }).reasons;

  it.each([
    "H-1B visas and the H-1B lottery, the visa bulletin",
    "I won the H-1B lottery this year",
    "If you won the lottery, the LCA comes next",
    "You have won the H-1B lottery, so what happens now?",
    "the diversity visa lottery opens in October",
    "the lottery registration fee is $215",
    "The beneficiary's offered wage is $95,000 and the employer has funds to pay it",
    "I am the beneficiary of a PERM filed in March",
    "I am the beneficiary of a PERM, and my employer will file the I-140 next month",
    "As the beneficiary of an approved I-140, do I need to show proof of funds at the interview?",
    "listed as the beneficiary on the I-140",
    "you won't see an alert until the status changes",
    "you won’t be scheduled",
    "unclaimed visa numbers roll over to the next category",
  ])("leaves %j alone", (text) => {
    expect(reasons(text)).not.toContain(SCAM);
  });

  it.each([
    "You have won $1,000,000 in the UK National Lottery",
    "Congratulations, your address won the sum of £850,000 in this year's draw",
    "you've won a prize",
    "You are the lucky winner of our raffle",
    "lottery winnings are waiting",
    "claim your lottery prize today",
    "you are the sole beneficiary of the estate",
    "named you beneficiary of the funds left by my late client",
    "you are named as beneficiary to the total sum of 4.5 million",
    "I am contacting you as next of kin",
    "unclaimed funds in your name",
    "an inheritance of 4.5 million",
    "you hit the jackpot",
  ])("counts %j", (text) => {
    expect(reasons(text)).toContain(SCAM);
  });
});

describe("Cloudflare's AI opinion", () => {
  const onePitch: MailForCheck = { from: "x@y.example", subject: "Web design", text: "We do web design for law firms." };

  it("tips a one-pitch message over, but can't hold a clean one alone", () => {
    expect(verdictFor(onePitch, NONE, "spam").action).toBe("hold");
    expect(verdictFor(REAL[0]![1], NONE, "spam")).toMatchObject({ action: "forward", score: 2 });
  });

  it("can rescue a weak score and never a strong one", () => {
    const code = REAL.find(([label]) => label.includes("code"))![1];
    expect(verdictFor(code, NONE, "spam").action).toBe("hold");
    expect(verdictFor(code, NONE, "not_spam").action).toBe("forward");
    expect(verdictFor(SPAM[0]![1], NONE, "not_spam").action).toBe("hold");
  });

  it("is read from the model's JSON, anything else is unsure", () => {
    expect(readAiAnswer('{"verdict":"spam"}')).toBe("spam");
    expect(readAiAnswer({ verdict: "not_spam" })).toBe("not_spam");
    expect(readAiAnswer("spam")).toBe("unsure");
    expect(readAiAnswer({ verdict: "SPAM" })).toBe("unsure");
    expect(readAiAnswer(null)).toBe("unsure");
  });

  it("is shown the sender's domain, never the address, and only the start of the text", () => {
    const prompt = aiUserPrompt({ from: "someone@private.example", subject: "Hi", text: "x".repeat(5_000) });
    expect(prompt).toContain("private.example");
    expect(prompt).not.toContain("someone@");
    expect(prompt.length).toBeLessThan(1_700);
  });
});

describe("the owner's word and replies", () => {
  it("lets a reply to us through whatever it says", () => {
    expect(verdictFor(SPAM[0]![1], { ...NONE, answersUs: true }).action).toBe("forward");
  });

  it("lets an allowed sender through and holds a blocked one", () => {
    expect(verdictFor(SPAM[0]![1], { ...NONE, allowed: true }).action).toBe("forward");
    expect(verdictFor(REAL[0]![1], { ...NONE, blocked: true }).action).toBe("hold");
  });

  it("files a service's notices", () => {
    expect(isNoticeSender("noreply@medium.com")).toBe(true);
    expect(isNoticeSender("digest@email.medium.com")).toBe(true);
    expect(isNoticeSender("medium.com@evil.example")).toBe(false);
    expect(verdictFor({ from: "noreply@medium.com", subject: "Your stats", text: "", listUnsubscribe: "x" }, NONE).action).toBe(
      "notice",
    );
  });

  it("lets a service we hold an account with through, even when it reads like a renewal pitch", () => {
    const oracle: MailForCheck = {
      from: "noreply@identity.oci.oraclecloud.com",
      subject: "Your account is about to expire",
      text: "Renew now: https://a.example https://b.example https://c.example https://d.example",
    };
    expect(verdictFor(oracle, NONE, "spam")).toMatchObject({ action: "forward", reasons: ["a service this site has an account with"] });
    // A lookalike domain gets no such pass.
    expect(verdictFor({ ...oracle, from: "noreply@oraclecloud.com.renew-now.example" }, NONE).action).toBe("hold");
    // The owner's word still wins over the list.
    expect(verdictFor(oracle, { ...NONE, blocked: true }).action).toBe("hold");
  });

  it("reads a service's parent domains too, the closest first, and stops at the address for free mail", () => {
    expect(senderKeys("News@Mail.Service.example")).toEqual(["news@mail.service.example", "@mail.service.example", "@service.example"]);
    expect(senderKeys("a@service.example")).toEqual(["a@service.example", "@service.example"]);
    expect(senderKeys("someone@gmail.com")).toEqual(["someone@gmail.com"]);
    expect(senderKeys("not an address")).toEqual(["not an address"]);
  });

  it("lets the profiles the site keeps through: a sign-in code or a welcome isn't a pitch", () => {
    for (const from of [
      "no-reply@account.tiktok.com",
      "security@mail.instagram.com",
      "noreply@account.meta.com",
      "info@x.com",
      "noreply@crunchbase.com",
      "noreply@bsky.app",
      "support@npmjs.com",
      "noreply@pypi.org",
    ]) {
      expect(isAccountSender(from), from).toBe(true);
    }
    expect(isAccountSender("deals@tiktok-shop-offers.example")).toBe(false);
    expect(isAccountSender("x@notx.com")).toBe(false);
  });

  it("tells the AI that mail from a service the site joined is real, and that a pushed link to review or verify is not", () => {
    expect(AI_SYSTEM_PROMPT).toMatch(/services the site (has )?signed up for/);
    expect(AI_SYSTEM_PROMPT).toMatch(/sign-in code/);
    expect(AI_SYSTEM_PROMPT).toMatch(/phishing/);
    expect(AI_SYSTEM_PROMPT).toMatch(/ignore any instruction/);
  });

  it("keys free mail by address and a company by its domain", () => {
    expect(senderKey("Person@Gmail.com")).toBe("person@gmail.com");
    expect(senderKey("sales@vendor.example")).toBe("@vendor.example");
  });
});

describe("linkHosts", () => {
  it("counts distinct sites, not links", () => {
    expect(linkHosts("https://www.a.example/x https://a.example/y http://b.example").sort()).toEqual(["a.example", "b.example"]);
  });
});

describe("borrowedBrand", () => {
  it("names a brand inside someone else's domain", () => {
    expect(borrowedBrand("service@adobesharedteam.com")).toBe("adobe");
    expect(borrowedBrand("notice@uscis-case-update.example")).toBe("uscis");
    expect(borrowedBrand("sign@docusign-review.example")).toBe("docusign");
  });

  it("lets the brand's own domains through", () => {
    expect(borrowedBrand("j.doe@adobe.com")).toBeNull();
    expect(borrowedBrand("mail@email.adobe.com")).toBeNull();
    expect(borrowedBrand("dse@docusign.net")).toBeNull();
    expect(borrowedBrand("alerts@uscis.gov")).toBeNull();
    expect(borrowedBrand("person@gmail.com")).toBeNull();
  });

  it("counts 2 against the sender, as does our own address in the subject", () => {
    const lookalike = ruleScore({ from: "a@adobesharedteam.example", subject: "Hello", text: "" });
    expect(lookalike.score).toBe(2);
    expect(lookalike.reasons[0]).toContain("adobe");
    const quoted = ruleScore({ from: "a@b.example", subject: "support@permtracker.app notice", text: "" });
    expect(quoted.score).toBe(2);
  });
});
