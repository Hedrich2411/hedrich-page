/**
 * Contracts for cross-component events. A separate module with no data on purpose:
 * living next to the computation would drag the whole JSON into the client bundle.
 */
export const ROLE_EVENT = "experience:role";
export type RoleDetail = { stack: string[] | null };
