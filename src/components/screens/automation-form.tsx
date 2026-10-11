"use client";
import { useState } from "react";
import { useWorkspace } from "../workspace-provider";
import { Field, Modal } from "../ui";
export function AutomationForm({ onClose }: { onClose: () => void }) {
  const { data, clientId, update, toast, cloud, saving, storageError } =
    useWorkspace();
  const [name, setName] = useState("");
  const [client, setClient] = useState(
    cloud && clientId === "all" ? data.clients[0]?.id || "" : clientId,
  );
  const [trigger, setTrigger] = useState(cloud ? "Manual" : "Content approved");
  return (
    <Modal title="New Automation" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          if (
            cloud &&
            (saving ||
              storageError ||
              !data.clients.some((c) => c.id === client))
          )
            return;
          update((prev) => ({
            ...prev,
            automations: [
              ...prev.automations,
              {
                id: crypto.randomUUID(),
                name: name.trim(),
                clientId: client,
                trigger,
                enabled: false,
                runs: [],
              },
            ],
          }));
          toast(
            cloud
              ? "Automation created. Connect a workflow to run it."
              : "Local workflow created",
          );
          onClose();
        }}
      >
        <Field label="Workflow Name">
          <input
            required
            maxLength={100}
            placeholder="e.g. Monthly client check-in"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Client">
          <select value={client} onChange={(e) => setClient(e.target.value)}>
            {!cloud && <option value="all">All Clients</option>}
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Trigger">
          <select value={trigger} onChange={(e) => setTrigger(e.target.value)}>
            {(cloud
              ? ["Manual"]
              : [
                  "Content approved",
                  "Form submission",
                  "Daily · 9 AM",
                  "Every Monday · 9 AM",
                  "Manual",
                ]
            ).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <p className="muted small-text">
          {cloud
            ? "Save this automation, then choose a workflow on the Automations screen. Runs start manually."
            : "Creates a local definition. It does not create or activate an n8n workflow yet."}
        </p>
        <div className="modal-footer">
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={cloud && (saving || !!storageError || !client)}
          >
            Create Workflow
          </button>
        </div>
      </form>
    </Modal>
  );
}
