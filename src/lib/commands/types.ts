/** Trusted identity comes from the session or a verified channel link, never the model. */
export interface CommandActor {
  accountId: string;
  userId: string;
  channel: import("../channels/types").MessageChannel;
  requestId: string;
  linkId?: string;
}

export type CommandStatus = "queued" | "running" | "waiting" | "done" | "blocked" | "failed" | "uncertain";

export interface RoutineCommand {
  id: string;
  actor: CommandActor;
  requestHash: string;
  routineId: string;
  specHash: string;
  workflowHash: string;
  version: number;
  request: string;
  status: CommandStatus;
  reply: string;
  runId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommandQueue {
  get(accountId: string, id: string): Promise<RoutineCommand | null>;
  enqueue(command: RoutineCommand): Promise<RoutineCommand>;
  list(status: CommandStatus, limit: number): Promise<RoutineCommand[]>;
  /** Compare-and-set: exactly one worker can claim a queued command. */
  transition(command: RoutineCommand, expected: CommandStatus, patch: Partial<Pick<RoutineCommand, "status" | "reply" | "runId" | "updatedAt">>): Promise<RoutineCommand | null>;
}

export interface DispatchReply { reply: string; commandId?: string; status?: CommandStatus }

/** Off until the migration, worker and customer acceptance checks have been verified. */
export const commandsEnabled = () => process.env.UNC_COMMANDS_ENABLED === "true";
