import { useWorkspace, type WorksheetId } from '../state/workspace';
import { Worksheet, type WorksheetProps } from './Worksheet-v0.2.0-2026.10.19';

type Props = Omit<WorksheetProps, 'onMetadataChange'> & { sheetId: WorksheetId };

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
