export {
  AIService as AI,
  AppService as Lifecycle,
  DesktopService as Desktop,
  RepositoryService as Git,
  WorkspaceService as Workspace,
  TerminalService as Term,
} from "../../bindings/mygit-wails3/internal/services";
export type {
  AIModel,
  Action,
  ChangeRequest,
  FileRequest,
  FileContent,
  Repository,
  HistoryPage,
  HistoryRequest,
  LineSelection,
  TerminalCommand,
  TerminalProfile,
  TerminalSessionLayout,
  TerminalSessionState,
  UpdateInfo,
} from "../../bindings/mygit-wails3/internal/services/models";
export type {
  State as WorkspaceState,
  Node as ProjectNode,
  Preferences,
  Group,
  Worktree,
} from "../../bindings/mygit-wails3/internal/workspace/models";
export type {
  Commit,
  FileChange,
  Ref,
  Line,
  BlameLine,
  RebaseCommit,
} from "../../bindings/mygit-wails3/internal/gitrepo/models";

import type {
  Action,
  ChangeRequest,
} from "../../bindings/mygit-wails3/internal/services/models";
export function action(
  kind: string,
  path: string,
  values: Partial<Action> = {},
): Action {
  return {
    Path: path,
    Kind: kind,
    Ref: "",
    Name: "",
    Value: "",
    Message: "",
    Remote: "",
    Files: [],
    Area: 0,
    Confirm: false,
    Force: false,
    Keep: true,
    Untracked: true,
    NoCommit: false,
    Rebase: false,
    Autostash: false,
    UpdateRefs: false,
    Track: false,
    Tags: false,
    Parent: 0,
    Mode: "",
    Plan: [],
    ...values,
  };
}
export function changeRequest(
  path: string,
  mode = "changes",
  revision = "",
  extra: Partial<ChangeRequest> = {},
): ChangeRequest {
  return {
    Path: path,
    Mode: mode,
    Revision: revision,
    From: "",
    To: "",
    File: "",
    ...extra,
  };
}
