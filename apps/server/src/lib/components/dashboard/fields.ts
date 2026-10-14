/** Tracker issue fields (J-140), the shape of integrations.send's `fields`. */
export interface Fields {
  repo?: string;
  title?: string;
  labels: string[];
  assignees: string[];
  milestone?: string;
  message?: string;
}
