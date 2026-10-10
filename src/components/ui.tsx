"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, FileImage, Instagram, Linkedin, Facebook } from "lucide-react";
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
      {value}
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
  const Icon =
    name === "Instagram"
      ? Instagram
      : name === "Facebook"
        ? Facebook
        : Linkedin;
  return (
    <span className={"platform " + name.toLowerCase()} title={name}>
      <Icon size={15} />
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
  }, [asset?.id, asset?.uploaded]);
  const src = asset?.uploaded
    ? asset.storagePath
      ? asset.url
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
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const elements = () =>
      ref.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input,select,textarea,a[href],[tabindex="0"]',
      );
    elements()?.[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
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
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={"modal " + (wide ? "wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-heading">
          <h2 id="modal-title">{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
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
