"use client";
import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "./workspace-provider";
import { cloudRequest, type Role } from "@/lib/cloud";
import { ImportBrowserRecords } from "./cloud-controls";
type Team = {
  members: { user_id: string; role: Role }[];
  access: { user_id: string; client_id: string }[];
  invitations: {
    id: string;
    email: string;
    role: string;
    client_ids: string[];
    expires_at: string;
  }[];
};
export function TeamSettings() {
  const { session, data, toast } = useWorkspace();
  const [team, setTeam] = useState<Team | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    try {
      setTeam(
        await cloudRequest<Team>(
          "/api/team?workspaceId=" + session?.workspaceId,
        ),
      );
    } catch (e) {
      setMessage((e as Error).message);
    }
  }, [session?.workspaceId]);
  useEffect(() => {
    if (session?.role === "owner") void reload();
  }, [reload, session?.role]);
  if (session?.role !== "owner")
    return (
      <section className="panel cloud-team">
        <h2>Your Access</h2>
        <p>
          {session?.email} · {session?.role.replaceAll("_", " ")}
        </p>
        <p>
          You have access to {data.clients.length} assigned clients. Contact
          your workspace owner to change access.
        </p>
      </section>
    );
  async function submit(body: unknown) {
    setBusy(true);
    try {
      await cloudRequest("/api/team", body);
      await reload();
      toast("Team access updated");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel cloud-team">
      <h2>Team & Client Permissions</h2>
      <p>
        Owners have agency-wide access. Team members edit assigned clients.
        Client reviewers see assigned content and assets and can leave feedback
        or approve submitted versions.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setBusy(true);
          setMessage("");
          try {
            const result = await cloudRequest<{
              link: string;
              emailError: string | null;
            }>("/api/team", {
              action: "invite",
              workspaceId: session?.workspaceId,
              email: form.get("email"),
              role: form.get("role"),
              clientIds: form.getAll("client"),
              sendEmail: form.has("sendEmail"),
            });
            setMessage(
              result.emailError
                ? "Invitation created, but email failed: " +
                    result.emailError +
                    ". Share this sign-in link with the invited email owner: " +
                    result.link
                : "Invitation created. Sign in with the invited, verified email at " +
                    result.link,
            );
            await reload();
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Invite Email
          <input name="email" type="email" required />
        </label>
        <label>
          Role
          <select name="role">
            <option value="team_member">Team Member</option>
            <option value="client_reviewer">Client Reviewer</option>
          </select>
        </label>
        <fieldset>
          <legend>Assigned Clients</legend>
          {data.clients.map((c) => (
            <label className="client-check" key={c.id}>
              <input type="checkbox" name="client" value={c.id} />
              {c.name}
            </label>
          ))}
        </fieldset>
        <label className="client-check">
          <input type="checkbox" name="sendEmail" />
          Send Invitation Email (Requires Server Configuration)
        </label>
        <button disabled={busy}>Create Invitation</button>
      </form>
      <p role="status">{message}</p>
      <h3>Members</h3>
      {team?.members.map((m) => (
        <Member
          key={m.user_id}
          member={m}
          clients={data.clients}
          assigned={team.access
            .filter((a) => a.user_id === m.user_id)
            .map((a) => a.client_id)}
          self={m.user_id === session?.userId}
          busy={busy}
          save={(role, clientIds, remove) =>
            submit({
              action: "manage",
              workspaceId: session?.workspaceId,
              userId: m.user_id,
              role,
              clientIds,
              remove,
            })
          }
        />
      ))}
      <h3>Pending Invitations</h3>
      {team?.invitations.map((i) => (
        <div className="cloud-member" key={i.id}>
          <span>
            {i.email} · {i.role.replaceAll("_", " ")} · expires{" "}
            {new Date(i.expires_at).toLocaleDateString()}
          </span>
          <button
            disabled={busy}
            onClick={() =>
              void submit({
                action: "revoke",
                workspaceId: session?.workspaceId,
                invitationId: i.id,
              })
            }
          >
            Revoke
          </button>
        </div>
      ))}
      <ImportBrowserRecords />
    </section>
  );
}
function Member({
  member,
  clients,
  assigned,
  self,
  busy,
  save,
}: {
  member: Team["members"][number];
  clients: { id: string; name: string }[];
  assigned: string[];
  self: boolean;
  busy: boolean;
  save: (role: Role, clients: string[], remove: boolean) => Promise<void>;
}) {
  const [role, setRole] = useState(member.role);
  const [ids, setIds] = useState(assigned);
  return (
    <div className="cloud-member">
      <span>{self ? "You" : member.user_id}</span>
      <select
        aria-label={"Role for " + member.user_id}
        disabled={self || busy}
        value={role}
        onChange={(e) => setRole(e.target.value as Role)}
      >
        <option value="owner">Owner</option>
        <option value="team_member">Team Member</option>
        <option value="client_reviewer">Client Reviewer</option>
      </select>
      {!self && (
        <>
          <fieldset>
            <legend>Clients</legend>
            {clients.map((c) => (
              <label className="client-check" key={c.id}>
                <input
                  type="checkbox"
                  disabled={busy || role === "owner"}
                  checked={ids.includes(c.id)}
                  onChange={(e) =>
                    setIds(
                      e.target.checked
                        ? [...ids, c.id]
                        : ids.filter((id) => id !== c.id),
                    )
                  }
                />
                {c.name}
              </label>
            ))}
          </fieldset>
          <button disabled={busy} onClick={() => void save(role, ids, false)}>
            Save Access
          </button>
          <button disabled={busy} onClick={() => void save(role, ids, true)}>
            Remove Member
          </button>
        </>
      )}
    </div>
  );
}
