"use client";

import { Fragment } from "react";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { t } from "@/lib/i18n";
import { fieldValidationError, type FieldDef } from "@/lib/formSchema";
import type { LangCode } from "@/types";

export function StepFields({
  fields,
  values,
  onChange,
  lang,
  activeFieldKey,
  disabledKeys,
  renderAfterField,
}: {
  fields: FieldDef[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  lang: LangCode;
  activeFieldKey: string | null;
  disabledKeys?: string[];
  renderAfterField?: (key: string) => React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        const wrapperClass = f.type === "textarea" ? "sm:col-span-2" : "";
        const isActive = f.key === activeFieldKey;
        const highlight = isActive
          ? "ring-2 ring-sprout-300 ring-offset-2 rounded-xl dark:ring-offset-ink-950"
          : "";
        const disabled = disabledKeys?.includes(f.key);
        const extra = renderAfterField?.(f.key);

        if (f.type === "choice") {
          return (
            <Fragment key={f.key}>
              <div className={`${wrapperClass} ${highlight}`}>
                <Select
                  id={f.key}
                  label={t(lang, f.labelKey)}
                  required={f.required}
                  disabled={disabled}
                  value={(values[f.key] as string) ?? ""}
                  onChange={(e) => onChange(f.key, e.target.value)}
                >
                  <option value="" disabled>
                    {t(lang, "selectPlaceholder")}
                  </option>
                  {f.choices?.map((c) => (
                    <option key={c.value} value={c.value}>
                      {t(lang, c.labelKey)}
                    </option>
                  ))}
                </Select>
              </div>
              {extra}
            </Fragment>
          );
        }
        if (f.type === "textarea") {
          return (
            <Fragment key={f.key}>
              <div className={`${wrapperClass} ${highlight}`}>
                <Textarea
                  id={f.key}
                  label={t(lang, f.labelKey)}
                  required={f.required}
                  disabled={disabled}
                  value={(values[f.key] as string) ?? ""}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  className={disabled ? "cursor-not-allowed opacity-60" : ""}
                />
              </div>
              {extra}
            </Fragment>
          );
        }
        return (
          <Fragment key={f.key}>
            <div className={`${wrapperClass} ${highlight}`}>
              <Input
                id={f.key}
                type={f.type === "number" ? "number" : "text"}
                label={t(lang, f.labelKey)}
                required={f.required}
                disabled={disabled}
                placeholder={f.placeholder}
                hint={f.hint}
                min={f.min}
                max={f.max}
                error={fieldValidationError(f, values[f.key], values) ?? undefined}
                value={(values[f.key] as string | number) ?? ""}
                onChange={(e) => onChange(f.key, f.type === "number" ? Number(e.target.value) : e.target.value)}
                className={disabled ? "cursor-not-allowed opacity-60" : ""}
              />
            </div>
            {extra}
          </Fragment>
        );
      })}
    </div>
  );
}
