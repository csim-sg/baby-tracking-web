import { createFileRoute } from "@tanstack/react-router";
import React, { useState } from "react";
import {
  Baby,
  CalendarDays,
  Check,
  ChevronDown,
  Download,
  Heart,
  Milk,
  Plus,
  Printer,
  Sparkles,
  Thermometer,
  Droplets,
  Moon,
  Toilet,
  Package,
  Soup,
  Syringe,
  Pill,
  Star,
  BookOpen,
  Bed,
  Clock3,
  LucideIcon,
} from "lucide-react";
export const Route = createFileRoute("/")({ component: Home });
const defaults = [
  "Diaper",
  "Formula",
  "Poop",
  "Breastfeeding",
  "Temperature",
  "Medicine",
  "Food",
  "Sleep",
];
const langs = [
  "English",
  "中文",
  "Bahasa Melayu",
  "தமிழ்",
  "日本語",
  "한국어",
  "Español",
  "Français",
];
const zh: Record<string, string> = {
  Diaper: "换尿布",
  Formula: "喂奶粉",
  Poop: "大便",
  Breastfeeding: "喂人奶",
  Temperature: "量体温",
  Medicine: "吃药",
  Food: "辅食",
  Sleep: "睡觉",
};
const customIconOptions: Record<string, LucideIcon> = {
  Check,
  Heart,
  Milk,
  Package,
  Baby,
  Droplets,
  Thermometer,
  Moon,
  Toilet,
  Soup,
  Syringe,
  Pill,
  Star,
  BookOpen,
  Bed,
  Clock3,
};
const defaultItemIcons: Record<string, string> = {
  diaper: "Baby",
  pee: "Droplets",
  formula: "Package",
  breastfeeding: "Milk",
  poop: "Toilet",
  temperature: "Thermometer",
  medicine: "Syringe",
  food: "Soup",
  sleep: "Moon",
};
/* T3 chrome conversion: static Tailwind class maps. State markers
 * (choice/active, item-chip/selected, picker-menu "active") stay semantic so
 * state still renders through complete literal strings only — no state- or
 * user-derived value is constructed into a class name (FR-19). */
const CHOICE_IDLE_CLASSES =
  "choice border border-chip-line rounded-[9px] bg-white p-[9px] text-chip-ink cursor-pointer";
const CHOICE_ACTIVE_CLASSES =
  "choice active border border-active-line rounded-[9px] bg-active-wash p-[9px] text-active-green cursor-pointer";
const CHIP_IDLE_CLASSES =
  "item-chip inline-flex items-center gap-[5px] rounded-[9px] border border-chip-line bg-white p-[7px] text-[9px] text-chip-ink cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed";
const CHIP_SELECTED_CLASSES =
  "item-chip selected inline-flex items-center gap-[5px] rounded-[9px] border border-active-line bg-active-wash p-[7px] text-[9px] text-active-green cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed";
const ADD_ITEM_INPUT_CLASSES =
  "min-w-0 flex-1 rounded-lg border border-control-line p-2 font-body text-[10px]";
const PICKER_OPTION_CLASSES =
  "w-full flex items-center gap-2 rounded-md bg-white p-[7px] text-left font-body text-[10px] text-[#58665c] cursor-pointer hover:bg-[#f0f6ec] hover:text-active-green disabled:opacity-40 disabled:cursor-not-allowed";
const PICKER_OPTION_ACTIVE_CLASSES =
  "active w-full flex items-center gap-2 rounded-md bg-active-wash p-[7px] text-left font-body text-[10px] text-active-green cursor-pointer hover:bg-[#f0f6ec] disabled:opacity-40 disabled:cursor-not-allowed";
function itemIcon(item: string, customIcons: Record<string, string> = {}) {
  const name =
    customIcons[item] || defaultItemIcons[item.toLowerCase()] || "Check";
  return customIconOptions[name] || Check;
}
function IconForItem({
  item,
  customIcons,
}: {
  item: string;
  customIcons: Record<string, string>;
}) {
  const Icon = itemIcon(item, customIcons);
  return <Icon className="item-row-icon" aria-hidden="true" />;
}
function IconPicker({
  value,
  usedIcons,
  onChange,
}: {
  value: string;
  usedIcons: Set<string>;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const Icon = customIconOptions[value] || Check;
  return (
    <div className="icon-picker relative flex-none">
      <button
        type="button"
        className="icon-picker-trigger h-full min-w-[42px] flex items-center justify-center gap-1 rounded-lg bg-control-wash px-2.5 py-0 text-control-green cursor-pointer"
        aria-label="Choose icon for custom item"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon size={14} />
        <ChevronDown size={12} className="w-[14px]" />
      </button>
      {open && (
        <div
          className="icon-picker-menu absolute bottom-[calc(100%_+_6px)] left-0 z-10 max-h-[200px] w-[150px] overflow-auto rounded-[10px] border border-control-line bg-white p-1 [box-shadow:0_8px_24px_rgba(53,68,63,0.1254901961)]"
          role="listbox"
        >
          {Object.entries(customIconOptions).map(([name, OptionIcon]) => (
            <button
              type="button"
              role="option"
              aria-selected={value === name}
              className={
                value === name
                  ? PICKER_OPTION_ACTIVE_CLASSES
                  : PICKER_OPTION_CLASSES
              }
              disabled={usedIcons.has(name)}
              key={name}
              onClick={() => {
                onChange(name);
                setOpen(false);
              }}
            >
              <OptionIcon size={14} />
              <span>{name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function Home() {
  const [days, setDays] = useState(2),
    [main, setMain] = useState("English"),
    [sub, setSub] = useState("中文"),
    [items, setItems] = useState([
      "Diaper",
      "Formula",
      "Poop",
      "Breastfeeding",
      "Temperature",
    ]),
    [custom, setCustom] = useState(""),
    [customTranslation, setCustomTranslation] = useState(""),
    [customIcon, setCustomIcon] = useState("Star"),
    [itemIcons, setItemIcons] = useState<Record<string, string>>({}),
    [itemTranslations, setItemTranslations] = useState<
      Record<string, { language: string; value: string }>
    >({});
  const times = Array.from(
    { length: 24 },
    (_, i) => `${i % 12 || 12}${i < 12 ? "AM" : "PM"}`,
  );
  const maxItems = days === 1 ? 16 : 7;
  const usedIcons = new Set(
    items.map(
      (item) =>
        itemIcons[item] || defaultItemIcons[item.toLowerCase()] || "Check",
    ),
  );
  const toggle = (x: string) =>
    setItems((s) =>
      s.includes(x)
        ? s.filter((v) => v !== x)
        : s.length < maxItems
          ? [...s, x]
          : s,
    );
  const add = () => {
    const value = custom.trim();
    if (
      value &&
      !items.includes(value) &&
      items.length < maxItems &&
      !usedIcons.has(customIcon)
    ) {
      setItems([...items, value]);
      setItemIcons({ ...itemIcons, [value]: customIcon });
      setItemTranslations((previous) => {
        const translation = customTranslation.trim();
        if (sub !== "None" && translation)
          return {
            ...previous,
            [value]: { language: sub, value: translation },
          };
        const next = { ...previous };
        delete next[value];
        return next;
      });
      setCustom("");
      setCustomTranslation("");
    }
  };
  return (
    <main className="app-shell mx-auto max-w-[1180px] px-[34px] max-md:px-[20px] max-sm:px-[14px]">
      <header className="topbar flex h-[74px] items-center justify-between border-b border-b-line print:hidden">
        <a className="brand flex items-center gap-2 font-display text-[20px] font-black text-[#283b38]">
          <span className="brand-mark rounded-xl bg-[#e8f2e9] p-1.5 text-[#5b8b68]">
            <Baby />
          </span>
          Tiny<span className="brand-accent text-[#f19b72]">Daybook</span>
        </a>
        <span className="top-note text-[12px] text-[#929b93] max-sm:hidden">
          A little record of a lot of love
        </span>
        <button
          className="top-print flex items-center gap-2 rounded-[11px] border border-[#dce9d8] bg-[#f2f7ed] px-[15px] py-[10px] font-bold text-[#496d4e] cursor-pointer"
          onClick={() => window.print()}
        >
          <Printer size={16} /> Print sheet
        </button>
      </header>
      <section className="hero grid grid-cols-[1fr_1fr] items-center min-h-[300px] px-2 py-[25px] max-sm:grid-cols-[1fr] max-sm:px-1 max-sm:py-[28px] print:hidden">
        <div>
          <div className="eyebrow text-[10px] font-extrabold tracking-[1.3px] text-[#e79871]">
            YOUR LITTLE ONE, DAY BY DAY <Sparkles size={14} />
          </div>
          <h1 className="font-display font-black text-[47px] leading-[1.05] tracking-[-1.7px] mt-[15px] mb-[12px] max-sm:text-[40px]">
            Little moments,
            <br />
            <em className="not-italic text-[#e59b79]">all in one place.</em>
          </h1>
          <p className="text-[13px] leading-[1.7] max-w-[415px] text-[#828a82]">
            A sweet, simple tracker for feeds, naps, and everything in between.
            Set it up, print it out, and make it yours.
          </p>
          <div className="hero-perks mt-[18px] flex gap-6 text-[11px] text-[#68786e]">
            <span>
              <Heart className="w-4 align-middle text-[#e39a7c]" /> Made for
              busy parents
            </span>
            <span>
              <Printer className="w-4 align-middle text-[#e39a7c]" />
              {" Print-ready, always"}
            </span>
          </div>
        </div>
        <div className="hero-art grid h-[240px] place-items-center rounded-[48%] bg-[#f8efd8] max-sm:h-[190px]">
          <div className="art-card rounded-[17px] border border-[#f1eadf] bg-white px-[22px] py-[18px] leading-[2] [transform:rotate(3deg)] text-[12px] text-[#708275] [box-shadow:0_14px_35px_rgba(86,66,34,0.0784313725)]">
            <b className="font-display font-extrabold text-[15px] leading-[normal] text-[#547961]">
              A lovely little day　☺
            </b>
            <p className="border-b border-dashed border-b-[#e8e0d7] text-[9px] leading-[1.7] tracking-[1px] text-[#b4aaa0]">
              MONDAY, OCT 21
            </p>
            <div>🥛　━━━━━━━━　8:10</div>
            <div>💧　━━━━━━━━　9:35</div>
            <div>🌡　━━━━━━━━　10:00</div>
            <p className="border-b border-dashed border-b-[#e8e0d7] text-[9px] leading-[1.7] tracking-[1px] text-[#b4aaa0]">
              you’re doing great　♥
            </p>
          </div>
        </div>
      </section>
      <section className="workspace border-t border-t-line px-2 pt-[27px] pb-[15px]">
        <div className="section-heading mb-[18px] print:hidden">
          <div>
            <span className="step-label text-[10px] font-extrabold tracking-[1.3px] text-[#e79871]">
              MAKE IT YOURS
            </span>
            <h2 className="font-display font-black text-[25px] my-[5px]">
              Build your day sheet
            </h2>
            <p className="m-0 text-[11px] text-[#8a918b]">
              Choose what to track, then print a fresh page whenever you need
              one.
            </p>
          </div>
        </div>
        <div className="builder-grid grid grid-cols-[0.88fr_1.12fr] gap-[18px] max-md:grid-cols-[1fr]">
          <div className="controls-card rounded-2xl border border-line bg-white px-[20px] py-[18px] [box-shadow:0_5px_20px_rgba(97,85,61,0.031372549)] print:hidden">
            <div className="control-title mb-[13px] flex items-center gap-2.5">
              <span className="number grid h-[27px] w-[27px] place-items-center rounded-lg bg-[#fff0e8] font-display text-[10px] font-extrabold text-[#e49a78]">
                01
              </span>
              <div>
                <h3 className="m-0 font-display text-[13px] font-extrabold text-[#35443f]">
                  Page setup
                </h3>
                <p className="my-[2px] text-[10px] text-[#9a9d95]">
                  Pick your print layout
                </p>
              </div>
            </div>
            <div className="field-label mt-[10px] mb-[7px] text-[8px] font-extrabold tracking-[1px] text-label-ink">
              DAYS PER PAGE
            </div>
            <div className="choice-row grid grid-cols-[1fr_1fr] gap-2">
              {[1, 2].map((n) => (
                <button
                  className={
                    days === n ? CHOICE_ACTIVE_CLASSES : CHOICE_IDLE_CLASSES
                  }
                  onClick={() => setDays(n)}
                  disabled={n === 2 && items.length > 7}
                  title={
                    n === 2 && items.length > 7
                      ? "Remove items to use two days per page"
                      : undefined
                  }
                  key={n}
                >
                  <CalendarDays className="w-4 align-middle" />
                  {n} day{n > 1 ? "s" : ""}{" "}
                  {days === n && <Check className="w-4 align-middle" />}
                </button>
              ))}
            </div>
            {days === 1 && items.length > 7 && (
              <p>Remove items to switch to two days per page.</p>
            )}
            <hr className="my-[15px] border-t border-t-[#f0ede7]" />
            <div className="control-title mb-[13px] flex items-center gap-2.5">
              <span className="number grid h-[27px] w-[27px] place-items-center rounded-lg bg-[#fff0e8] font-display text-[10px] font-extrabold text-[#e49a78]">
                02
              </span>
              <div>
                <h3 className="m-0 font-display text-[13px] font-extrabold text-[#35443f]">
                  What to track
                </h3>
                <p className="my-[2px] text-[10px] text-[#9a9d95]">
                  Select the items for your sheet · up to {maxItems}
                </p>
              </div>
            </div>
            <div className="item-chips flex flex-wrap gap-1.5">
              {defaults.map((x) => {
                const Icon = itemIcon(x);
                return (
                  <button
                    className={
                      items.includes(x)
                        ? CHIP_SELECTED_CLASSES
                        : CHIP_IDLE_CLASSES
                    }
                    onClick={() => toggle(x)}
                    disabled={!items.includes(x) && items.length >= maxItems}
                    key={x}
                  >
                    <Icon className="size-3.5 flex-none align-middle" /> {x}
                  </button>
                );
              })}
              {items
                .filter((x) => !defaults.includes(x))
                .map((x) => {
                  const Icon = itemIcon(x, itemIcons);
                  return (
                    <button
                      className={CHIP_SELECTED_CLASSES}
                      onClick={() => toggle(x)}
                      key={x}
                    >
                      <Icon className="size-3.5 flex-none align-middle" /> {x}{" "}
                      <span aria-hidden="true">×</span>
                    </button>
                  );
                })}
            </div>
            <div className="add-item relative mt-[9px] flex gap-1.5">
              <input
                className={ADD_ITEM_INPUT_CLASSES}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
                placeholder="Add a custom item"
              />
              <IconPicker
                value={customIcon}
                usedIcons={usedIcons}
                onChange={setCustomIcon}
              />
              <button
                className="flex items-center gap-1 rounded-lg bg-control-wash px-2.5 py-0 text-control-green cursor-pointer"
                onClick={add}
                disabled={items.length >= maxItems || usedIcons.has(customIcon)}
              >
                <Plus className="w-[14px]" /> Add
              </button>
              {sub !== "None" && (
                <input
                  className={
                    ADD_ITEM_INPUT_CLASSES +
                    " custom-translation flex-[1_0_100%]"
                  }
                  value={customTranslation}
                  onChange={(e) => setCustomTranslation(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && add()}
                  aria-label={`Custom item name in ${sub}`}
                  placeholder={`${sub} name (optional)`}
                />
              )}
            </div>
            <hr className="my-[15px] border-t border-t-[#f0ede7]" />
            <div className="control-title mb-[13px] flex items-center gap-2.5">
              <span className="number grid h-[27px] w-[27px] place-items-center rounded-lg bg-[#fff0e8] font-display text-[10px] font-extrabold text-[#e49a78]">
                03
              </span>
              <div>
                <h3 className="m-0 font-display text-[13px] font-extrabold text-[#35443f]">
                  Your languages
                </h3>
                <p className="my-[2px] text-[10px] text-[#9a9d95]">
                  Main language and optional helper
                </p>
              </div>
            </div>
            <div className="language-fields grid grid-cols-[1fr_1fr] gap-[9px]">
              {[main, sub].map((l, i) => (
                <label
                  key={i}
                  className="text-[8px] font-extrabold text-label-ink"
                >
                  {i ? "SUB LANGUAGE" : "MAIN LANGUAGE"}
                  <select
                    className="mt-[6px] block w-full rounded-lg border border-control-line bg-white p-2 font-body text-[10px] font-normal text-[#526056]"
                    value={l}
                    onChange={(e) =>
                      i ? setSub(e.target.value) : setMain(e.target.value)
                    }
                  >
                    {(i ? ["None", ...langs] : langs).map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                  <ChevronDown />
                </label>
              ))}
            </div>
          </div>
          <div className="preview-column">
            <div className="preview-head flex justify-between px-[2px] pt-[2px] pb-[9px] text-[9px] text-[#959b92] print:hidden">
              <b className="tracking-[1px] text-[#69796d]">LIVE PREVIEW</b>
              <span>Landscape · A4</span>
            </div>
            <div className="paper-wrap">
              <div className={`paper ${days === 2 ? "two-days" : ""}`}>
                {Array.from({ length: days }, (_, d) => (
                  <div className="print-day" key={d}>
                    <div className="print-head">
                      <div className="print-date">
                        {main === "中文" ? "日期" : "Date"}
                        {sub !== "None" &&
                          ` / ${sub === "中文" ? "日期" : "Date"}`}
                        <span>________________</span>
                      </div>
                      {d === 0 && (
                        <div className="item-legend">
                          {items.map((x) => {
                            const Icon = itemIcon(x, itemIcons);
                            return (
                              <span className="legend-item" key={x}>
                                <Icon aria-hidden="true" />
                                <span>
                                  {main === "中文" ? zh[x] || x : x}
                                  {sub === "None"
                                    ? ""
                                    : ` / ${
                                        (itemTranslations[x]?.language ===
                                          sub &&
                                          itemTranslations[x].value) ||
                                        (sub === "中文" ? zh[x] || x : x)
                                      }`}
                                </span>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <table
                      className="tracking-table"
                      aria-label={`${
                        main === "中文" ? "每日照护记录" : "Daily care tracker"
                      } ${d + 1}`}
                      style={
                        { "--item-count": items.length } as React.CSSProperties
                      }
                    >
                      <thead>
                        <tr>
                          <th className="table-corner" scope="col">
                            <i className="corner-diagonal" aria-hidden="true" />
                            <span className="corner-time-label">
                              {main === "中文" ? "时间" : "Time"}
                            </span>
                            <span>{main === "中文" ? "事件" : "Event"}</span>
                          </th>
                          {times.map((t) => (
                            <th className="time-heading" key={t} scope="col">
                              {t}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((x, i) => (
                          <tr key={x}>
                            <th
                              className={`item-heading tint-${i % 5}`}
                              scope="row"
                              aria-label={main === "中文" ? zh[x] || x : x}
                            >
                              <IconForItem item={x} customIcons={itemIcons} />
                            </th>
                            {times.map((t) => (
                              <td className="tracking-cell" key={`${x}-${t}`} />
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
            <div className="preview-footer mt-[11px] flex items-center justify-end gap-3 max-sm:flex-wrap print:hidden">
              <span className="mr-auto text-[9px] text-[#929b91]">
                Updates as you edit
              </span>
              <button
                className="flex items-center gap-[7px] rounded-[9px] bg-[#658a68] px-[13px] py-[10px] text-[10px] font-bold text-white cursor-pointer"
                onClick={() => window.print()}
              >
                <Printer className="w-[15px]" /> Print my sheet →
              </button>
              <button
                className="download-link flex items-center gap-[7px] rounded-[9px] bg-transparent py-[7px] text-[9px] font-bold text-[#748578] cursor-pointer"
                onClick={() => window.print()}
              >
                <Download className="w-[15px]" /> Save as PDF
              </button>
            </div>
          </div>
        </div>
        <div className="bottom-note p-[17px] text-center text-[10px] text-[#a1a397] print:hidden">
          ♡ Designed with care for the beautiful chaos of little days.
        </div>
      </section>
      <footer className="flex h-[44px] items-center justify-between border-t border-t-line text-[9px] text-[#a4a69d] print:hidden">
        © 2026 Tiny Daybook <span>Made for the moments that matter　♥</span>
      </footer>
    </main>
  );
}
