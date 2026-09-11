import type { Manifest } from 'pointto';

/**
 * Hand-written, exactly as a developer would after reviewing what the scanner
 * produced. Phase 5's CLI must learn to generate a file shaped like this.
 *
 * Anchors are ordered most durable first. The playground's "break" toggles
 * knock out the top anchors one at a time so you can watch the cascade fall
 * through while the light keeps landing on the same button.
 */
export const manifest: Manifest = {
  version: 1,
  generatedAt: '2026-09-11T00:00:00Z',
  baseUrl: 'http://localhost:5173',
  routes: [
    {
      path: '/',
      label: 'Playground',
      elements: [
        {
          id: 'team.invite-member',
          purpose: 'Opens the dialog to invite a new person to the workspace',
          aliases: ['add someone', 'invite someone', 'invite a user', 'add a teammate', 'new member', 'add a person to my team'],
          category: 'team-management',
          anchors: [
            { kind: 'testid', value: 'invite-member-btn', confidence: 1 },
            { kind: 'role-name', role: 'button', name: 'Invite member', confidence: 0.8 },
            { kind: 'text', value: 'Invite member', confidence: 0.6 },
            { kind: 'css', value: '#team-panel button', confidence: 0.3 },
          ],
          destructive: false,
        },
        {
          id: 'billing.manage',
          purpose: 'Opens the billing settings for the workspace',
          aliases: ['billing', 'payment', 'change my plan', 'subscription', 'where is billing', 'manage billing'],
          category: 'billing',
          anchors: [
            { kind: 'testid', value: 'billing-btn', confidence: 1 },
            { kind: 'role-name', role: 'button', name: 'Manage billing', confidence: 0.8 },
            { kind: 'text', value: 'Manage billing', confidence: 0.6 },
            { kind: 'css', value: '#billing-panel button', confidence: 0.3 },
          ],
          destructive: false,
        },
      ],
    },
  ],
};
