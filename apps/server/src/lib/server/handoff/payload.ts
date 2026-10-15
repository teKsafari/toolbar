// The `feedback` part of feedback.created and feedback.resolved webhook deliveries: where an agent
// gets the folder, the command that pulls it, the skill, and the resolution.
import type { WebhookPayload } from '@toolbar/shared/api';
import { SKILL_PATH, folderApiPath, pullCommand } from '@toolbar/shared/areas/handoff';
import { env } from '../env.ts';

export type FeedbackPayload = NonNullable<WebhookPayload['data']['feedback']>;

export function feedbackPayload(id: string, resolution: FeedbackPayload['resolution']): FeedbackPayload {
  return {
    folderUrl: `${env.publicUrl}${folderApiPath(id)}`,
    pullCommand: pullCommand(env.publicUrl, id),
    skillUrl: `${env.publicUrl}${SKILL_PATH}`,
    resolution,
  };
}
