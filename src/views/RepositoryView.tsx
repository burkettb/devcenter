import { useEffect, useMemo, useState } from "react";
import { DocBrowser } from "../components/DocBrowser";
import { TaskBoard, toBoardTasks } from "../components/TaskBoard";
import { Badge } from "../slate/core/Badge";
import { Accordion } from "../slate/core/Accordion";
import { Card } from "../slate/core/Card";
import { Icon } from "../slate/core/Icon";
import { Tag } from "../slate/core/Tag";
import { EmptyState } from "../slate/feedback/EmptyState";
import { Breadcrumbs } from "../slate/navigation/Breadcrumbs";
import { Tabs } from "../slate/navigation/Tabs";
import {
  branchIsStale,
  branchRoleHues,
  buildBranchMapRows,
  formatAheadBehind,
  formatCommitStats,
  formatDate,
  formatProjectStatus,
  formatRelative,
  groupDirtyFiles,
  hiddenOptionalIssueCount,
  openTaskCount,
  projectStatusTone,
  repoStateTone,
  severityTone,
  visibleComplianceIssues,
  type BranchMapRow,
  type DirtyFileGroups
} from "../lib/format";
import type {
  BranchCommit,
  BranchCommitsResponse,
  DocumentResponse,
  GitGraphCommit,
  ProjectSummary,
  ProjectTask
} from "../types";

type RepoTab = "tasks" | "overview" | "git" | "docs";
type GitDetailsTab = "graph" | "dirty" | "branches" | "worktrees" | "stashes";
type BranchCommitsState = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; commits: BranchCommit[] };

const WORK_GROUP_PREVIEW_LIMIT = 10;

const workGroupLabels: Record<keyof DirtyFileGroups, string> = {
  staged: "Staged",
  unstaged: "Unstaged",
  untracked: "Untracked",
  deleted: "Deleted"
};

function refTone(ref: string): "info" | "neutral" {
  return ref === "HEAD" || ref.startsWith("HEAD -> ") ? "info" : "neutral";
}

function CommitTimeline({ state }: { state?: BranchCommitsState }) {
  if (!state || state.state === "loading") {
    return <p className="dc-subtle">Loading recent commits…</p>;
  }

  if (state.state === "error") {
    return <p className="dc-subtle">Commits could not be loaded: {state.message}</p>;
  }

  if (state.commits.length === 0) {
    return <p className="dc-subtle">No commits found on this branch.</p>;
  }

  return (
    <div className="dc-commits" role="list">
      {state.commits.map((commit) => {
        const stats = formatCommitStats(commit);
        return (
          <div className="dc-commit" key={commit.hash} role="listitem">
            <code title={commit.hash}>{commit.shortHash}</code>
            <div className="dc-commit-main">
              <span className="dc-commit-subject" title={commit.subject}>
                {commit.subject}
              </span>
              <span className="dc-commit-byline">
                {commit.author ?? "Unknown author"} · {formatDate(commit.date)}
                {stats ? ` · ${stats}` : ""}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BranchMap({ project }: { project: ProjectSummary }) {
  const [expandedBranch, setExpandedBranch] = useState<string | undefined>(undefined);
  const [commitsByBranch, setCommitsByBranch] = useState<Record<string, BranchCommitsState>>({});
  const rows = useMemo(() => buildBranchMapRows(project), [project]);

  useEffect(() => {
    setExpandedBranch(undefined);
    setCommitsByBranch({});
  }, [project.path]);

  async function toggleBranch(row: BranchMapRow) {
    const next = expandedBranch === row.name ? undefined : row.name;
    setExpandedBranch(next);

    if (!next || !row.existsLocally || commitsByBranch[row.name]) {
      return;
    }

    setCommitsByBranch((current) => ({ ...current, [row.name]: { state: "loading" } }));

    try {
      const search = new URLSearchParams({ path: project.path, branch: row.name });
      const response = await fetch(`/api/branch-commits?${search}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
        throw new Error(body?.error ?? `Request failed with status ${response.status}.`);
      }

      const payload = (await response.json()) as BranchCommitsResponse;
      setCommitsByBranch((current) => ({ ...current, [row.name]: { state: "ready", commits: payload.commits } }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setCommitsByBranch((current) => ({ ...current, [row.name]: { state: "error", message } }));
    }
  }

  return (
    <div className="dc-branch-list" role="list">
      {project.branchIntentsExist ? null : (
        <p className="dc-subtle">Branch roles such as deployed or rewrite can be recorded in .devcenter/branches.yaml.</p>
      )}
      {rows.map((row) => {
        const expanded = expandedBranch === row.name;
        const role = row.intent?.role;
        return (
          <div className="dc-branch-item" key={row.name} role="listitem">
            <button aria-expanded={expanded} className="dc-branch-row" onClick={() => void toggleBranch(row)} type="button">
              <Icon name="chevron-right" size={14} className={expanded ? "dc-branch-chevron dc-branch-chevron--open" : "dc-branch-chevron"} />
              <span className="dc-branch-name" title={row.name}>
                {row.name}
              </span>
              <span className="dc-branch-labels">
                {row.current ? <Badge tone="info">Current</Badge> : null}
                {role ? (
                  <Tag boxed hue={branchRoleHues[role] ?? "blue"}>
                    {role}
                  </Tag>
                ) : null}
                {row.intent?.status ? <Badge boxed tone="neutral">{row.intent.status}</Badge> : null}
                {!row.existsLocally ? <Badge tone="warning">Not Local</Badge> : null}
                {row.branch && branchIsStale(row.branch) ? <Badge tone="warning">Stale</Badge> : null}
              </span>
              <span className="dc-branch-muted">{row.intent?.parent ? `from ${row.intent.parent}` : ""}</span>
              <span className="dc-branch-muted">{row.branch ? formatAheadBehind(row.branch) : ""}</span>
              <span className="dc-branch-muted">{row.branch?.lastCommitDate ? formatRelative(row.branch.lastCommitDate) : ""}</span>
            </button>
            {expanded ? (
              <div className="dc-branch-detail">
                {row.intent?.purpose ? <p>{row.intent.purpose}</p> : null}
                {(row.worktreePath ?? row.intent?.worktree) ? (
                  <p className="dc-subtle">
                    Worktree: <code>{row.worktreePath ?? row.intent?.worktree}</code>
                  </p>
                ) : null}
                {row.intent && row.intent.notes.length > 0 ? (
                  <ul>
                    {row.intent.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : null}
                {row.existsLocally ? (
                  <CommitTimeline state={commitsByBranch[row.name]} />
                ) : (
                  <p className="dc-subtle">This branch is recorded in branches.yaml but does not exist locally.</p>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
      {rows.length === 0 ? <p className="dc-subtle">No local branches found.</p> : null}
    </div>
  );
}

function GitGraphList({ commits }: { commits?: GitGraphCommit[] }) {
  if (!commits || commits.length === 0) {
    return <p className="dc-subtle">No graph commits found.</p>;
  }

  return (
    <div className="dc-git-list" role="list">
      {commits.map((commit) => (
        <div className={commit.head ? "dc-graph-row dc-graph-row--head" : "dc-graph-row"} key={commit.hash} role="listitem">
          <span className="dc-graph-glyphs" aria-hidden="true">
            {commit.graph || "*"}
          </span>
          <div className="dc-graph-commit">
            <div className="dc-graph-meta">
              {commit.refs.map((ref) => (
                <Badge boxed key={`${commit.hash}-${ref}`} tone={refTone(ref)}>
                  {ref}
                </Badge>
              ))}
              <code title={commit.hash}>{commit.shortHash}</code>
              <time>{formatDate(commit.date)}</time>
            </div>
            <span className="dc-commit-subject" title={commit.subject}>
              {commit.subject}
            </span>
            <span className="dc-commit-byline">
              {commit.author ?? "Unknown author"}
              {commit.parents.length > 1 ? ` · ${commit.parents.length} parents` : ""}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function GitDetails({ project }: { project: ProjectSummary }) {
  const [activeTab, setActiveTab] = useState<GitDetailsTab>("graph");

  const counts: Record<GitDetailsTab, number> = {
    graph: project.git.graph?.length ?? 0,
    dirty: project.git.dirtyFiles?.length ?? project.git.uncommittedCount + project.git.untrackedCount,
    branches: project.git.localBranches?.length ?? project.git.localBranchCount,
    worktrees: project.git.worktrees?.length ?? project.git.worktreeCount,
    stashes: project.git.stashes?.length ?? project.git.stashCount
  };

  const items = [
    { value: "graph", label: `Graph (${counts.graph})` },
    { value: "dirty", label: `Dirty Changes (${counts.dirty})` },
    { value: "branches", label: `Branches (${counts.branches})` },
    { value: "worktrees", label: `Worktrees (${counts.worktrees})` },
    { value: "stashes", label: `Stashes (${counts.stashes})` }
  ];

  return (
    <div>
      <Tabs items={items} value={activeTab} onChange={(value) => setActiveTab(value as GitDetailsTab)} />
      <div className="dc-git-panel" role="tabpanel">
        {activeTab === "graph" ? <GitGraphList commits={project.git.graph} /> : null}

        {activeTab === "dirty" ? (
          (project.git.dirtyFiles?.length ?? 0) > 0 ? (
            <div className="dc-git-list" role="list">
              {project.git.dirtyFiles.map((file) => (
                <div className="dc-git-row" key={`${file.status}-${file.originalPath ?? ""}-${file.path}`} role="listitem">
                  <code>{file.status}</code>
                  <span className="dc-git-path">
                    {file.path}
                    {file.originalPath ? ` (from ${file.originalPath})` : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="dc-clean-line">No dirty changes.</p>
          )
        ) : null}

        {activeTab === "branches" ? (
          (project.git.localBranches?.length ?? 0) > 0 ? (
            <div className="dc-git-list" role="list">
              {project.git.localBranches.map((branch) => (
                <div className="dc-git-row" key={branch.name} role="listitem">
                  <span className="dc-branch-name">{branch.name}</span>
                  {branch.name === project.git.currentBranch ? <Badge tone="info">Current</Badge> : null}
                  {branchIsStale(branch) ? <Badge tone="warning">Stale</Badge> : null}
                  <span className="dc-git-muted">
                    {branch.upstream ?? "No upstream"} · {formatAheadBehind(branch)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="dc-subtle">No local branches found.</p>
          )
        ) : null}

        {activeTab === "worktrees" ? (
          (project.git.worktrees?.length ?? 0) > 0 ? (
            <div className="dc-git-list" role="list">
              {project.git.worktrees.map((worktree) => (
                <div className="dc-git-row" key={`${worktree.path}-${worktree.branch ?? worktree.head ?? ""}`} role="listitem">
                  <span className="dc-git-path">{worktree.path}</span>
                  <span className="dc-git-muted">{worktree.branch ?? worktree.head ?? "unknown"}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="dc-subtle">No worktrees found.</p>
          )
        ) : null}

        {activeTab === "stashes" ? (
          (project.git.stashes?.length ?? 0) > 0 ? (
            <div className="dc-git-list" role="list">
              {project.git.stashes.map((stash) => (
                <div className="dc-git-row" key={`${stash.name}-${stash.hash ?? stash.index}`} role="listitem">
                  <code>{stash.name}</code>
                  <span className="dc-git-path">{stash.message}</span>
                  <span className="dc-git-muted">{formatDate(stash.date)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="dc-clean-line">No stashes.</p>
          )
        ) : null}
      </div>
    </div>
  );
}

function WorkState({ project }: { project: ProjectSummary }) {
  const groups = groupDirtyFiles(project.git.dirtyFiles);

  if (!project.git.dirty) {
    return <p className="dc-clean-line">The working tree is clean.</p>;
  }

  return (
    <div className="dc-work-groups">
      {(Object.keys(workGroupLabels) as Array<keyof DirtyFileGroups>).map((key) => {
        const files = groups[key];
        const visible = files.slice(0, WORK_GROUP_PREVIEW_LIMIT);
        const hidden = files.length - visible.length;
        return (
          <div className="dc-work-group" key={key}>
            <h4>
              {workGroupLabels[key]}
              <span className="dc-lane-count">{files.length}</span>
            </h4>
            {visible.length > 0 ? (
              <ul>
                {visible.map((file) => (
                  <li key={`${file.status}-${file.originalPath ?? ""}-${file.path}`} title={`${file.status} ${file.path}`}>
                    <code>{file.status.trim()}</code>
                    <span>{file.path}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dc-subtle">None.</p>
            )}
            {hidden > 0 ? <p className="dc-subtle">+{hidden} more.</p> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Read-only peek at one project document (context.md, agent-log.md, …). */
function DocPeek({ project, docKey }: { project: ProjectSummary; docKey: string }) {
  const doc = project.documents.find((entry) => entry.key === docKey);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setContent("");
      setError("");
      if (!doc?.exists) {
        return;
      }

      try {
        const search = new URLSearchParams({ path: project.path, doc: doc.relativePath });
        const response = await fetch(`/api/document?${search}`);
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const payload = (await response.json()) as DocumentResponse;
        setContent(payload.content);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "The document could not be loaded.");
      }
    }

    void load();
  }, [project.path, doc?.exists, doc?.relativePath]);

  if (!doc?.exists) {
    return <p className="dc-subtle">No {doc?.relativePath ?? docKey} recorded for this project.</p>;
  }

  if (error) {
    return <p className="dc-clean-line">{error}</p>;
  }

  return <pre className="dc-doc-pre dc-doc-peek">{content || "This document has no content yet."}</pre>;
}

function OverviewTab({ project, showOptionalMetadataIssues }: { project: ProjectSummary; showOptionalMetadataIssues: boolean }) {
  const issues = visibleComplianceIssues(project, showOptionalMetadataIssues);
  const optionalHidden = showOptionalMetadataIssues ? 0 : hiddenOptionalIssueCount(project);
  const stack = project.metadata.stack;
  const tags = project.metadata.tags;

  return (
    <div className="dc-grid">
      <Card title="Briefing">
        <p className="dc-clean-line" style={{ marginBottom: "var(--space-4)" }}>
          {project.metadata.summary ?? "No project summary recorded in .devcenter/project.yaml."}
        </p>
        <dl className="dc-facts">
          <div>
            <dt>Path</dt>
            <dd className="dc-mono" title={project.path}>
              {project.relativePath}
            </dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{project.metadata.owner ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{project.metadata.created ? formatDate(project.metadata.created) : "Unknown"}</dd>
          </div>
          {stack.length > 0 ? (
            <div>
              <dt>Stack</dt>
              <dd>
                <span className="dc-chips">
                  {stack.map((item) => (
                    <span className="dc-chip" key={item}>
                      {item}
                    </span>
                  ))}
                </span>
              </dd>
            </div>
          ) : null}
          {tags.length > 0 ? (
            <div>
              <dt>Tags</dt>
              <dd>
                <span className="dc-chips">
                  {tags.map((item) => (
                    <span className="dc-chip" key={item}>
                      {item}
                    </span>
                  ))}
                </span>
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>

      <Card title="Activity">
        <dl className="dc-facts">
          <div>
            <dt>Current Focus</dt>
            <dd>{project.metadata.current_focus ?? "No current focus recorded."}</dd>
          </div>
          <div>
            <dt>Last Commit</dt>
            <dd>{formatDate(project.git.lastCommit.date)}</dd>
          </div>
          <div>
            <dt>Subject</dt>
            <dd>{project.git.lastCommit.subject ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Author</dt>
            <dd>{project.git.lastCommit.author ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Context Updated</dt>
            <dd>{formatRelative(project.contextUpdatedAt)}</dd>
          </div>
          <div>
            <dt>Agent Log</dt>
            <dd>{formatRelative(project.lastAiUpdate)}</dd>
          </div>
        </dl>
      </Card>

      <Card title="Context" description=".devcenter/context.md — what agents read at session start.">
        <DocPeek project={project} docKey="context" />
      </Card>

      <Card title="Agent Log" description=".devcenter/agent-log.md — the newest entries are at the bottom.">
        <DocPeek project={project} docKey="agent-log" />
      </Card>

      <Card className="dc-span-2" title="Compliance">
        {issues.length > 0 ? (
          <ul className="dc-issues">
            {issues.map((issue) => (
              <li className="dc-issue" key={`${issue.code}-${issue.file ?? issue.message}`}>
                <Badge tone={severityTone(issue)}>{issue.optional ? "optional" : issue.severity}</Badge>
                <span className="dc-issue-message">{issue.message}</span>
                {issue.file ? <code>{issue.file}</code> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="dc-clean-line">No compliance issues found.</p>
        )}
        {optionalHidden > 0 ? <p className="dc-subtle">{optionalHidden} optional metadata checks are hidden.</p> : null}
      </Card>
    </div>
  );
}

export function RepositoryView({
  project,
  onBack,
  showOptionalMetadataIssues,
  onTaskSaved
}: {
  project?: ProjectSummary;
  onBack: () => void;
  showOptionalMetadataIssues: boolean;
  onTaskSaved: (projectId: string, tasks: ProjectTask[]) => void;
}) {
  const [tab, setTab] = useState<RepoTab>("tasks");

  useEffect(() => {
    setTab("tasks");
  }, [project?.id]);

  const boardTasks = useMemo(() => (project ? toBoardTasks([project]) : []), [project]);

  if (!project) {
    return (
      <div className="dc-page">
        <EmptyState
          icon="squares-2x2"
          title="No Repository Selected"
          description="Pick a repository on the Dashboard to see its tasks, memory, and git state here."
        />
      </div>
    );
  }

  const state = repoStateTone(project);
  const dirtyCount = project.git.dirtyFiles?.length ?? project.git.uncommittedCount + project.git.untrackedCount;

  const summary: Array<{ label: string; value: string | number; tone?: "warning" | "danger" }> = [
    { label: "Open Tasks", value: openTaskCount(project) },
    { label: "Blocked", value: project.taskCounts.blocked, tone: project.taskCounts.blocked ? "danger" : undefined },
    { label: "Branches", value: project.git.branchCount },
    { label: "Dirty Files", value: dirtyCount, tone: dirtyCount ? "warning" : undefined },
    { label: "Ahead / Behind", value: `${project.git.ahead ?? 0} / ${project.git.behind ?? 0}` },
    { label: "Last Change", value: formatRelative(project.lastChange ?? project.git.lastCommit.date) }
  ];

  const tabs: Array<{ value: RepoTab; label: string }> = [
    { value: "tasks", label: `Tasks (${openTaskCount(project)})` },
    { value: "overview", label: "Overview" },
    ...(project.git.isRepo ? [{ value: "git" as const, label: "Git" }] : []),
    { value: "docs", label: "Docs" }
  ];

  return (
    <div className="dc-page">
      <Breadcrumbs items={[{ label: "Dashboard" }, { label: project.name }]} onNavigate={onBack} />

      <header className="dc-page-head">
        <div>
          <h1 className="sds-type-h3">{project.name}</h1>
          <p className="dc-page-meta">
            <code>{project.path}</code>
          </p>
        </div>
        <div className="dc-head-badges">
          <Badge tone={projectStatusTone(project.status)}>{formatProjectStatus(project.status)}</Badge>
          <Badge tone={state.tone}>{state.label}</Badge>
        </div>
      </header>

      <div className="dc-minimetrics dc-minimetrics--flush" aria-label="Repository summary">
        {summary.map((metric) => (
          <div
            className={metric.tone && metric.value ? `dc-minimetric dc-minimetric--${metric.tone}` : "dc-minimetric"}
            key={metric.label}
          >
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>

      <Tabs items={tabs} value={tab} onChange={(value) => setTab(value as RepoTab)} />

      {tab === "tasks" ? (
        boardTasks.length > 0 ? (
          <TaskBoard tasks={boardTasks} onTaskSaved={onTaskSaved} />
        ) : (
          <EmptyState
            size="sm"
            icon="clipboard"
            title="No Tasks Recorded"
            description="Tasks from this repository's .devcenter/tasks.yaml will appear here. Add one with `devcenter task add`."
          />
        )
      ) : null}

      {tab === "overview" ? <OverviewTab project={project} showOptionalMetadataIssues={showOptionalMetadataIssues} /> : null}

      {tab === "git" && project.git.isRepo ? (
        <Accordion
          multiple
          items={[
            { title: `Local Work State (${dirtyCount} dirty files, ${project.git.stashCount} stashes)`, content: <WorkState project={project} /> },
            { title: `Branch Map (${buildBranchMapRows(project).length} branches)`, content: <BranchMap project={project} /> },
            { title: "Git Details — Graph, Changes, Worktrees, Stashes", content: <GitDetails project={project} /> }
          ]}
        />
      ) : null}

      {tab === "docs" ? <DocBrowser project={project} /> : null}
    </div>
  );
}
