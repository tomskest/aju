import { redirect } from "next/navigation";

/**
 * Legacy URL — signup verify used to land here. Now we send new users
 * straight into the dashboard at /app/onboarding so the sidebar nav is
 * visible. This redirect keeps any bookmarked or emailed links working.
 */
export default function WelcomeRedirect(): never {
  redirect("/app/onboarding");
}
