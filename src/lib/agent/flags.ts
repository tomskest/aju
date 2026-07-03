/**
 * aju Tag (Slack integration) feature flag.
 *
 * Everything under /api/integrations/slack/* and the agent worker is gated
 * on INTEGRATION_SLACK_ENABLED=1. Flag off → routes 404, the worker exits at
 * boot, the settings UI hides the section. Core aju is unaffected either way
 * — see doc/spec-slack-tag.md §4.
 */
export function slackIntegrationEnabled(): boolean {
  return process.env.INTEGRATION_SLACK_ENABLED === "1";
}
