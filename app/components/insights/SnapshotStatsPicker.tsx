import { Select, BlockStack, Checkbox, Text } from "@shopify/polaris";
import { useState } from "react";

interface Snapshot {
  id: string;
  label: string;
}

interface SnapshotStatsPickerProps {
  snapshots: Snapshot[];
}

export function SnapshotStatsPicker({ snapshots }: SnapshotStatsPickerProps) {
  const [attach, setAttach] = useState(false);
  const [selected, setSelected] = useState("");

  if (snapshots.length === 0) return null;

  const options = [
    { label: "Choose a snapshot...", value: "" },
    ...snapshots.map((s) => ({ label: s.label, value: s.id })),
  ];

  return (
    <BlockStack gap="200">
      <Checkbox
        label="Attach anonymized stats from a snapshot"
        checked={attach}
        onChange={setAttach}
        helpText="Only percentages and averages are shared — no shop, product, or visitor details."
      />
      {attach && (
        <>
          <Select
            label="Snapshot"
            options={options}
            value={selected}
            onChange={setSelected}
          />
          <input type="hidden" name="snapshotId" value={attach ? selected : ""} />
        </>
      )}
    </BlockStack>
  );
}
