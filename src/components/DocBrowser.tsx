import { useEffect, useState } from "react";
import { Card } from "../slate/core/Card";
import type { DocumentResponse, ProjectDocument, ProjectSummary } from "../types";

/** Document list + reader for one repository, including .devcenter memory files. */
export function DocBrowser({ project }: { project: ProjectSummary }) {
  const [selectedDoc, setSelectedDoc] = useState<ProjectDocument | undefined>();
  const [documentContent, setDocumentContent] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const firstDoc = project.documents.find((doc) => doc.exists);
    setSelectedDoc(firstDoc);
  }, [project]);

  useEffect(() => {
    async function loadDocument() {
      if (!selectedDoc?.exists) {
        setDocumentContent("");
        return;
      }

      try {
        setError("");
        const search = new URLSearchParams({ path: project.path, doc: selectedDoc.relativePath });
        const response = await fetch(`/api/document?${search}`);
        if (!response.ok) {
          throw new Error(await response.text());
        }

        const payload = (await response.json()) as DocumentResponse;
        setDocumentContent(payload.content);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "The document could not be loaded.");
      }
    }

    void loadDocument();
  }, [project, selectedDoc]);

  return (
    <div className="dc-docs-layout">
      <nav className="dc-doc-list" aria-label="Documents">
        {project.documents.map((doc) => (
          <button
            className={selectedDoc?.key === doc.key ? "sds-nav-item sds-nav-item--active dc-doc-item" : "sds-nav-item dc-doc-item"}
            disabled={!doc.exists}
            key={doc.key}
            onClick={() => setSelectedDoc(doc)}
            type="button"
          >
            <span>
              {doc.label}
              <small>{doc.exists ? doc.relativePath : "Missing"}</small>
            </span>
          </button>
        ))}
      </nav>

      <Card title={selectedDoc?.label ?? "No Document"} description={selectedDoc ? <code>{selectedDoc.relativePath}</code> : undefined}>
        {error ? (
          <p className="dc-clean-line">{error}</p>
        ) : (
          <pre className="dc-doc-pre">{documentContent || "This document has no content yet."}</pre>
        )}
      </Card>
    </div>
  );
}
