export type AnchorKind = 'testid' | 'role-name' | 'text' | 'css';

export interface TestIdAnchor { kind: 'testid'; value: string; confidence: number }
export interface RoleNameAnchor { kind: 'role-name'; role: string; name: string; confidence: number }
export interface TextAnchor { kind: 'text'; value: string; confidence: number }
export interface CssAnchor { kind: 'css'; value: string; confidence: number }

export type Anchor = TestIdAnchor | RoleNameAnchor | TextAnchor | CssAnchor;

export interface ManifestElement {
  id: string;
  /** Null when the labeler could not infer a purpose. Never invent one. */
  purpose: string | null;
  aliases: string[];
  category?: string;
  anchors: Anchor[];
  /** Element ids that must be interacted with first to reach this one. */
  requires?: string[];
  destructive?: boolean;
}

export interface ManifestRoute { path: string; label: string; elements: ManifestElement[] }
export interface ManifestFlow { id: string; intent: string; steps: string[] }

export interface Manifest {
  version: 1;
  generatedAt: string;
  baseUrl: string;
  routes: ManifestRoute[];
  flows?: ManifestFlow[];
}
