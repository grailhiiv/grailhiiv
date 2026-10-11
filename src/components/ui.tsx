"use client";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { X, FileImage } from "lucide-react";
import { SocialIcon } from "./social-icon";
import { titleLabel } from "@/lib/labels";
import type { Asset, Client } from "@/lib/types";
import { loadFile } from "@/lib/assets";
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}
export function Status({ value }: { value: string }) {
  return (
    <Badge
      tone={
        value === "Scheduled" ||
        value === "Approved" ||
        value === "Success" ||
        value === "Won"
          ? "green"
          : value === "Awaiting approval" || value === "Contacted"
            ? "amber"
            : value === "Changes requested" || value === "Failed"
              ? "red"
              : value === "Qualified"
                ? "blue"
                : "neutral"
      }
    >
      {titleLabel(value)}
    </Badge>
  );
}
export function ClientMark({
  client,
  small = false,
}: {
  client: Client | undefined;
  small?: boolean;
}) {
  return (
    <span
      className={"client-mark " + (small ? "small" : "")}
      style={{ background: client?.color }}
    >
      {client?.logo ? (
        <img src={client.logo} alt="" />
      ) : (
        client?.initials || "GH"
      )}
    </span>
  );
}
export function Platform({ name }: { name: string }) {
  return (
    <span className={"platform " + name.toLowerCase()} title={name}>
      <SocialIcon name={name} />
      <span>{name}</span>
    </span>
  );
}
export function AssetPreview({
  asset,
  className = "",
  variant,
}: {
  asset: Asset | undefined;
  className?: string;
  variant?: "overview" | "calendar" | "approval" | "detail";
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setUrl("");
    if (asset?.uploaded && !asset.storagePath) {
      loadFile(asset.id)
        .then((blob) => {
          if (blob && active) {
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset?.id, asset?.uploaded, asset?.storagePath]);
  const src = asset?.uploaded
    ? asset.storagePath
      ? asset.thumbnailPath && variant !== "detail" ? asset.url + "&thumbnail=1" : asset.url
      : url
    : (variant && asset?.variants?.[variant]) || asset?.url;
  if (src && asset?.type.startsWith("image/"))
    return (
      <img
        className={"asset-preview " + className}
        src={src}
        alt={asset.name}
      />
    );
  if (src && asset?.type.startsWith("video/"))
    return (
      <video
        className={"asset-preview " + className}
        src={src}
        controls
        preload="metadata"
      />
    );
  return (
    <div className={"asset-preview placeholder " + className}>
      <FileImage />
      <span>{asset?.name || "No asset selected"}</span>
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <FileImage size={26} />
      </div>
      <h3>{titleLabel(title)}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
const modalStack: string[] = [];
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    modalStack.push(titleId);
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const elements = () =>
      ref.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input,select,textarea,a[href],[tabindex="0"]',
      );
    elements()?.[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== titleId) return;
      if (event.key === "Escape") {
        closeRef.current();
      }
      if (event.key === "Tab") {
        const all = elements();
        if (!all?.length) return;
        const first = all[0],
          last = all[all.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      modalStack.splice(modalStack.indexOf(titleId), 1);
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={"modal " + (wide ? "wide " : "") + className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-heading">
          <h2 id={titleId}>{title}</h2>
          <button
            className="icon-button"
            type="button"
            aria-label="Close Dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
const detailQuery = "(max-width: 1200px)";
function subscribeDetailLayout(onChange: () => void) {
  const media = window.matchMedia(detailQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
export function DetailsPanel({
  title,
  className,
  onClose,
  children,
}: {
  title: string;
  className: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const compact = useSyncExternalStore(
    subscribeDetailLayout,
    () => window.matchMedia(detailQuery).matches,
    () => false,
  );
  if (compact)
    return (
      <Modal title={title} onClose={onClose}>
        <div className={className}>{children}</div>
      </Modal>
    );
  return <aside className={"panel " + className}>{children}</aside>;
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
