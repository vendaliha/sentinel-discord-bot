import {
  Cell,
  ConfirmButton,
  ErrorNote,
  Loading,
  Notice,
  Row,
  Section,
  Stat,
  Table,
} from "../components/Section";
import { formatBytes, formatDateTime } from "../lib/format";
import { sectionsApi } from "../lib/sections";
import { useDashboard } from "../lib/store";
import { useSection } from "../lib/useSection";

export default function BackupsPage() {
  const { notify } = useDashboard();
  const { data, loading, error, saving, reload } = useSection(sectionsApi.backups);

  if (loading && !data) return <Loading label="Loading backups…" />;
  if (!data) return <ErrorNote message={error || "Could not load backups."} onRetry={() => void reload()} />;

  const totalBytes = data.files.reduce((total, file) => total + file.bytes, 0);

  async function createBackup() {
    try {
      const result = await sectionsApi.createBackup();
      notify(`Backup created (${formatBytes(result.bytes)})`);
      await reload();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "The backup could not be created.");
    }
  }

  return (
    <div className="space-y-5">
      {error ? <ErrorNote message={error} onRetry={() => void reload()} /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Backups" value={data.files.length} hint="SQLite snapshots on the host" tone="brand" />
        <Stat label="Total size" value={formatBytes(totalBytes)} />
        <Stat
          label="Latest"
          value={data.files[0] ? formatBytes(data.files[0].bytes) : "None"}
          hint={data.files[0] ? formatDateTime(data.files[0].createdAt) : "Create the first one"}
          tone={data.files.length ? "good" : "warn"}
        />
      </div>

      <Section
        title="Database backups"
        description={`Snapshots are written to ${data.directory} using SQLite's online backup API, so the bot keeps running.`}
        actions={
          <ConfirmButton
            title="Create a backup now?"
            message="The bot copies the live database to a timestamped file in the backups folder. Nothing is modified."
            confirmLabel="Create backup"
            disabled={saving}
            onConfirm={createBackup}
          >
            Create backup
          </ConfirmButton>
        }
      >
        <Table head={["File", "Size", "Created"]} empty="No backups yet.">
          {data.files.map((file) => (
            <Row key={file.name}>
              <Cell className="mono text-mist-200">{file.name}</Cell>
              <Cell className="mono">{formatBytes(file.bytes)}</Cell>
              <Cell className="whitespace-nowrap text-[11px]">{formatDateTime(file.createdAt)}</Cell>
            </Row>
          ))}
        </Table>
      </Section>

      <Section title="Restoring a backup" description="Restores overwrite the live database, so they are intentionally gated.">
        <div className="space-y-2 text-xs text-mist-400">
          <p>
            Restore is not exposed here: it replaces the database file while the bot is running and would corrupt the
            connection the API holds. Use the bot's <span className="mono text-mist-200">/restore</span> command, which
            stops writes, verifies the file and requires an explicit confirmation.
          </p>
          <p>
            Backups are stored inside the bot's own folder, so keep off-host copies of anything you cannot rebuild.
          </p>
        </div>
        <div className="mt-4">
          <Notice tone="neutral">
            Only files created by the bot appear here; nothing on this page can delete a backup.
          </Notice>
        </div>
      </Section>
    </div>
  );
}
