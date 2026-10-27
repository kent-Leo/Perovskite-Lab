import { useWorkspace } from '../state/workspace';
import { Worksheet, type WorksheetProps } from './Worksheet-v0.3.0-2026.10.27';

type Props = Omit<WorksheetProps, 'onMetadataChange'> & {
  /** Metadata key of the active sheet: the page id ('raw', 'screening'…) or a created sheet id. */
  sheetId: string;
};

export function WorkspaceWorksheet({ sheetId, columns, ...props }: Props) {
  const { w, update } = useWorkspace();
  const metadata = w.sheetMetadata?.[sheetId];
  return (
    <Worksheet
      {...props}
      columns={columns.map((column) => ({ ...column, ...metadata?.[column.key] }))}
      onMetadataChange={(index, field, value) => {
        const key = columns[index]?.key;
        if (!key) return;
        update((prev) => ({
          sheetMetadata: {
            ...prev.sheetMetadata,
            [sheetId]: {
              ...prev.sheetMetadata?.[sheetId],
              [key]: { ...prev.sheetMetadata?.[sheetId]?.[key], [field]: value },
            },
          },
        }));
      }}
    />
  );
}
