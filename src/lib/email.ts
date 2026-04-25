/**
 * Email sender via Resend. Keep templates inline for now — move to
 * React Email when we have more than a handful.
 */

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

const RESEND_API = "https://api.resend.com/emails";

export async function sendEmail(args: SendArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[email] RESEND_API_KEY not set — would have sent:", args);
      return;
    }
    throw new Error("RESEND_API_KEY not configured");
  }

  const from = process.env.EMAIL_FROM ?? "aju <hello@aju.sh>";
  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend send failed (${res.status}): ${body}`);
  }
}

export function magicLinkEmail(to: string, url: string) {
  const subject = "your aju sign-in link";
  const text = `Click to sign in to aju:\n\n${url}\n\nThis link expires in 30 minutes.\nIf you didn't request this, ignore this email.\n\n— aju.sh`;
  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:40px 20px;background:#050608;color:#e8e8ea;font-family:ui-sans-serif,system-ui,sans-serif;">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;">
      <tr><td style="padding-bottom:32px;">
        <div style="font-size:28px;font-weight:300;letter-spacing:-0.03em;color:#e8e8ea;">aju</div>
      </td></tr>
      <tr><td style="padding-bottom:24px;font-size:15px;line-height:1.6;color:#e8e8ea;">
        Welcome. Click below to finish signing in and claim your beta slot.
      </td></tr>
      <tr><td style="padding-bottom:32px;">
        <a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#22c55e;color:#050608;font-family:ui-monospace,Menlo,monospace;font-size:13px;font-weight:500;text-decoration:none;">Sign in to aju</a>
      </td></tr>
      <tr><td style="padding-bottom:16px;font-size:12px;color:#67676d;line-height:1.6;">
        Or paste this URL into your browser:
      </td></tr>
      <tr><td style="padding-bottom:32px;font-size:12px;color:#67676d;font-family:ui-monospace,Menlo,monospace;word-break:break-all;">
        ${url}
      </td></tr>
      <tr><td style="padding-top:32px;border-top:1px solid #1c1c20;font-size:11px;color:#3a3a40;line-height:1.6;">
        This link expires in 30 minutes. If you didn't request it, ignore this email.<br/>
        aju.sh &middot; TARK Technology OÜ
      </td></tr>
    </table>
  </body>
</html>`;
  return { to, subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SHELL_STYLES = `margin:0;padding:40px 20px;background:#050608;color:#e8e8ea;font-family:ui-sans-serif,system-ui,sans-serif;`;
const TABLE_STYLES = `max-width:480px;margin:0 auto;`;
const LOGO_STYLES = `font-size:28px;font-weight:300;letter-spacing:-0.03em;color:#e8e8ea;`;
const BODY_STYLES = `font-size:15px;line-height:1.6;color:#e8e8ea;`;
const BUTTON_STYLES = `display:inline-block;padding:12px 20px;border-radius:8px;background:#22c55e;color:#050608;font-family:ui-monospace,Menlo,monospace;font-size:13px;font-weight:500;text-decoration:none;`;
const FOOTER_STYLES = `padding-top:32px;border-top:1px solid #1c1c20;font-size:11px;color:#3a3a40;line-height:1.6;`;
const MUTED_STYLES = `font-size:12px;color:#67676d;line-height:1.6;`;
const MONO_STYLES = `font-family:ui-monospace,Menlo,monospace;`;

export function orgInvitationEmail(args: {
  to: string;
  inviterName: string;
  orgName: string;
  role: string;
  acceptUrl: string;
  expiresInHours: number;
}) {
  const { to, inviterName, orgName, role, acceptUrl, expiresInHours } = args;
  const safeInviter = escapeHtml(inviterName);
  const safeOrg = escapeHtml(orgName);
  const safeRole = escapeHtml(role);
  const subject = `You're invited to join ${orgName} on aju`;
  const text = `Hi,\n\n${inviterName} invited you to join ${orgName} on aju as a ${role}.\n\nAccept within ${expiresInHours} hours:\n${acceptUrl}\n\nIf you didn't expect this, ignore this email.\n\n— aju.sh · TARK Technology OÜ`;
  const html = `
<!doctype html>
<html>
  <body style="${SHELL_STYLES}">
    <table role="presentation" width="100%" style="${TABLE_STYLES}">
      <tr><td style="padding-bottom:32px;">
        <div style="${LOGO_STYLES}">aju</div>
      </td></tr>
      <tr><td style="padding-bottom:24px;${BODY_STYLES}">
        Hi, ${safeInviter} invited you to join <strong>${safeOrg}</strong> on aju as a <span style="${MONO_STYLES}">${safeRole}</span>. Accept within ${expiresInHours} hours.
      </td></tr>
      <tr><td style="padding-bottom:32px;">
        <a href="${acceptUrl}" style="${BUTTON_STYLES}">Accept invitation</a>
      </td></tr>
      <tr><td style="padding-bottom:16px;${MUTED_STYLES}">
        Or paste this URL into your browser:
      </td></tr>
      <tr><td style="padding-bottom:32px;font-size:12px;color:#67676d;${MONO_STYLES}word-break:break-all;">
        ${acceptUrl}
      </td></tr>
      <tr><td style="${FOOTER_STYLES}">
        If you didn't expect this, ignore this email.<br/>
        aju.sh &middot; TARK Technology OÜ
      </td></tr>
    </table>
  </body>
</html>`;
  return { to, subject, html, text };
}


export function accessRequestReviewEmail(args: {
  to: string;
  requesterEmail: string;
  orgName: string;
  message?: string;
  reviewUrl: string;
}) {
  const { to, requesterEmail, orgName, message, reviewUrl } = args;
  const safeRequester = escapeHtml(requesterEmail);
  const safeOrg = escapeHtml(orgName);
  const subject = `${requesterEmail} wants to join ${orgName}`;
  const trimmedMessage = message?.trim();
  const messageTextBlock = trimmedMessage
    ? `\n\nTheir message:\n> ${trimmedMessage.replace(/\n/g, "\n> ")}\n`
    : "";
  const text = `Someone at your domain wants to join ${orgName} on aju: ${requesterEmail}.${messageTextBlock}\n\nReview and approve:\n${reviewUrl}\n\n— aju.sh · TARK Technology OÜ`;
  const messageHtmlBlock = trimmedMessage
    ? `
      <tr><td style="padding-bottom:24px;">
        <div style="padding:12px 16px;border-left:2px solid #22c55e;background:#0c0d11;font-size:14px;line-height:1.6;color:#e8e8ea;white-space:pre-wrap;">${escapeHtml(
          trimmedMessage,
        )}</div>
      </td></tr>`
    : "";
  const html = `
<!doctype html>
<html>
  <body style="${SHELL_STYLES}">
    <table role="presentation" width="100%" style="${TABLE_STYLES}">
      <tr><td style="padding-bottom:32px;">
        <div style="${LOGO_STYLES}">aju</div>
      </td></tr>
      <tr><td style="padding-bottom:24px;${BODY_STYLES}">
        Someone at your domain wants to join <strong>${safeOrg}</strong> on aju: <span style="${MONO_STYLES}">${safeRequester}</span>.
      </td></tr>${messageHtmlBlock}
      <tr><td style="padding-bottom:32px;">
        <a href="${reviewUrl}" style="${BUTTON_STYLES}">Review and approve</a>
      </td></tr>
      <tr><td style="padding-bottom:16px;${MUTED_STYLES}">
        Or paste this URL into your browser:
      </td></tr>
      <tr><td style="padding-bottom:32px;font-size:12px;color:#67676d;${MONO_STYLES}word-break:break-all;">
        ${reviewUrl}
      </td></tr>
      <tr><td style="${FOOTER_STYLES}">
        aju.sh &middot; TARK Technology OÜ
      </td></tr>
    </table>
  </body>
</html>`;
  return { to, subject, html, text };
}

export function accessRequestApprovedEmail(args: {
  to: string;
  orgName: string;
  orgUrl: string;
}) {
  const { to, orgName, orgUrl } = args;
  const safeOrg = escapeHtml(orgName);
  const subject = `Welcome to ${orgName} on aju`;
  const text = `Your request to join ${orgName} was approved. You can now collaborate with your team.\n\nOpen ${orgName}:\n${orgUrl}\n\n— aju.sh · TARK Technology OÜ`;
  const html = `
<!doctype html>
<html>
  <body style="${SHELL_STYLES}">
    <table role="presentation" width="100%" style="${TABLE_STYLES}">
      <tr><td style="padding-bottom:32px;">
        <div style="${LOGO_STYLES}">aju</div>
      </td></tr>
      <tr><td style="padding-bottom:24px;${BODY_STYLES}">
        Your request to join <strong>${safeOrg}</strong> was approved. You can now collaborate with your team.
      </td></tr>
      <tr><td style="padding-bottom:32px;">
        <a href="${orgUrl}" style="${BUTTON_STYLES}">Open ${safeOrg}</a>
      </td></tr>
      <tr><td style="padding-bottom:16px;${MUTED_STYLES}">
        Or paste this URL into your browser:
      </td></tr>
      <tr><td style="padding-bottom:32px;font-size:12px;color:#67676d;${MONO_STYLES}word-break:break-all;">
        ${orgUrl}
      </td></tr>
      <tr><td style="${FOOTER_STYLES}">
        aju.sh &middot; TARK Technology OÜ
      </td></tr>
    </table>
  </body>
</html>`;
  return { to, subject, html, text };
}

export function accessRequestDeniedEmail(args: {
  to: string;
  orgName: string;
}) {
  const { to, orgName } = args;
  const safeOrg = escapeHtml(orgName);
  const subject = `Update on your ${orgName} access request`;
  const text = `Your request to join ${orgName} wasn't approved at this time.\n\nIf you think this is a mistake, reach out to your team admin directly. You can continue using aju in your personal workspace.\n\n— aju.sh · TARK Technology OÜ`;
  const html = `
<!doctype html>
<html>
  <body style="${SHELL_STYLES}">
    <table role="presentation" width="100%" style="${TABLE_STYLES}">
      <tr><td style="padding-bottom:32px;">
        <div style="${LOGO_STYLES}">aju</div>
      </td></tr>
      <tr><td style="padding-bottom:24px;${BODY_STYLES}">
        Your request to join <strong>${safeOrg}</strong> wasn't approved at this time.
      </td></tr>
      <tr><td style="padding-bottom:32px;${BODY_STYLES}">
        If you think this is a mistake, reach out to your team admin directly. You can continue using aju in your personal workspace.
      </td></tr>
      <tr><td style="${FOOTER_STYLES}">
        aju.sh &middot; TARK Technology OÜ
      </td></tr>
    </table>
  </body>
</html>`;
  return { to, subject, html, text };
}
