import { Badge } from "../slate/core/Badge";
import { Card } from "../slate/core/Card";
import { Breadcrumbs } from "../slate/navigation/Breadcrumbs";
import { taskStatusLabels } from "../lib/format";
import type { ProjectsResponse, TaskStatus } from "../types";

export function StandardsView({ data, onBack }: { data?: ProjectsResponse; onBack: () => void }) {
  const standards = data?.standards;

  return (
    <div className="dc-page">
      <Breadcrumbs items={[{ label: "Dashboard" }, { label: "Standards" }]} onNavigate={onBack} />
      <header className="dc-page-head">
        <div>
          <h1 className="sds-type-h3">Standards</h1>
          <p className="dc-page-meta">Effective standards: built-in defaults merged with the home repo's global overlay.</p>
        </div>
      </header>

      <div className="dc-grid">
        <Card title="Required Files" description="Every repository is checked for these.">
          <ul className="dc-standards-list">
            {standards?.required_files.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </Card>

        <Card title="Task Statuses" description="Valid statuses in .devcenter/tasks.yaml.">
          <div className="dc-doc-badges">
            {standards?.task_statuses.map((status) => (
              <Badge boxed key={status} tone="neutral">
                {taskStatusLabels[status as TaskStatus] ?? status}
              </Badge>
            ))}
          </div>
        </Card>

        <Card title="Branch Naming" description="Expected prefixes for new branches.">
          <dl className="dc-facts">
            {Object.entries(standards?.branch_naming ?? {}).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd className="dc-mono">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {standards?.preferred_license ? (
          <Card title="Licensing">
            <dl className="dc-facts">
              <div>
                <dt>Preferred License</dt>
                <dd>{standards.preferred_license}</dd>
              </div>
            </dl>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
