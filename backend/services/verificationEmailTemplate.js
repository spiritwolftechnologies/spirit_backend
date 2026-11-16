const path = require("node:path");

const LOGO_CID = "spiritwolf-logo";

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildVerificationEmail(name, code) {
  const safeName = escapeHtml(name);

  return {
    text: [
      `Hello ${name},`,
      "",
      "Welcome to Spiritwolf Technologies. Use the verification code below to complete your account registration:",
      "",
      code,
      "",
      "This code expires in 5 minutes. If you did not request this code, you can safely ignore this email.",
      "",
      "Spiritwolf Technologies",
    ].join("\n"),
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>Verify your email</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#17233c;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your Spiritwolf verification code expires in 5 minutes.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f3f5f9;">
      <tr>
        <td align="center" style="padding:36px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
            <tr>
              <td align="center" style="padding:8px 0 24px;">
                <img src="cid:${LOGO_CID}" width="220" alt="Spiritwolf Technologies" style="display:block;width:220px;max-width:80%;height:auto;border:0;">
              </td>
            </tr>
            <tr>
              <td style="padding:0;background-color:#ffffff;border:1px solid #e5e9f1;border-radius:12px;overflow:hidden;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="height:5px;background-color:#284a78;font-size:0;line-height:0;">&nbsp;</td>
                  </tr>
                  <tr>
                    <td style="padding:36px 40px 18px;">
                      <p style="margin:0 0 10px;color:#60718b;font-size:12px;font-weight:bold;letter-spacing:1.6px;text-transform:uppercase;">Email verification</p>
                      <h1 style="margin:0 0 18px;color:#17233c;font-size:26px;line-height:1.3;font-weight:700;">Welcome to Spiritwolf</h1>
                      <p style="margin:0 0 14px;color:#34435b;font-size:16px;line-height:1.65;">Hello ${safeName},</p>
                      <p style="margin:0;color:#526078;font-size:15px;line-height:1.7;">Use this one-time code to verify your email address and finish creating your account.</p>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:10px 40px 22px;">
                      <div style="display:inline-block;padding:16px 28px;background-color:#f1f5fa;border:1px solid #e3eaf3;border-radius:8px;color:#18365d;font-size:32px;font-weight:700;letter-spacing:9px;line-height:1.2;">${code}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 40px 32px;">
                      <p style="margin:0 0 12px;color:#34435b;font-size:14px;line-height:1.6;"><strong>This code expires in 5 minutes.</strong></p>
                      <p style="margin:0;color:#718096;font-size:13px;line-height:1.7;">For your security, never share this code. If you did not request an account, you can safely ignore this message.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:22px 12px 0;color:#8792a3;font-size:12px;line-height:1.6;">
                <p style="margin:0 0 4px;">Spiritwolf Technologies</p>
                <p style="margin:0;">This is an automated message; please do not reply.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    attachments: [
      {
        filename: "spiritwolf-logo.png",
        path: path.join(__dirname, "..", "assets", "image.png"),
        cid: LOGO_CID,
      },
    ],
  };
}

module.exports = { buildVerificationEmail };
