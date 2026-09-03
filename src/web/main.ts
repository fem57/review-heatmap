/*
Review Heatmap Add-on for Anki

Copyright (C) 2016-2022  Aristotelis P. <https//glutanimate.com/>

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version, with the additions
listed at the end of the accompanied license file.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

NOTE: This program is subject to certain additional terms pursuant to
Section 7 of the GNU Affero General Public License.  You should have
received a copy of these additional terms immediately following the
terms and conditions of the GNU Affero General Public License which
accompanied this program.

If not, please request a copy through one of the means of contact
listed here: <https://glutanimate.com/contact/>.

Any modifications to this file must keep this entire header intact.
*/

import "./_vendor/cal-heatmap.css";
import "./css/review-heatmap.css";

import { CalHeatMap } from "./_vendor/cal-heatmap.js";
import { ReviewHeatmapOptions, ReviewHeatmapData } from "./types";
import { bridgeCommand } from "./bridge";

interface CalHeatmapFormatData {
  count: string | undefined;
  name: string;
  connector: string;
  date: Date;
}

interface CalHeatmapCellData {
  v: number; // count
  t: number; // timestamp
}

// "Weekly Timeline" mode doesn't use cal-heatmap at all: cal-heatmap's
// domain/subDomain model can only stack a week's days vertically in a
// single narrow column (the same width as one day cell), which can't
// produce a real calendar-style layout (one row per week, days laid out
// left-to-right Mon-Sun). WeekRows below is a small hand-rolled SVG
// renderer for that instead. It reuses the exact same CSS classes
// cal-heatmap itself uses for cell coloring (.graph-rect, .q1-.q20, etc,
// all scoped under .cal-heatmap-container) so it matches the current
// color theme and night mode automatically, with no separate CSS to
// maintain per-theme.

const SVG_NS = "http://www.w3.org/2000/svg";
const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
// Monday-indexed (0=Mon..6=Sun) to match the week-row day order below.
const WEEKDAY_ABBR = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const WEEKDAY_FULL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// All of the timestamps we work with (options.today/start/stop and the
// keys of the data dict) represent a real-world instant equal to local
// midnight, expressed as if it were a UTC epoch (see the afterLoadData
// comment in the cal-heatmap path below for the same quirk). Reading them
// back out with the UTC-suffixed Date getters therefore recovers the
// correct local calendar date directly, with no local-timezone-offset
// workaround needed.
function utcMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

function addDaysUTC(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

function mondayOfUTC(date: Date): Date {
  const daysSinceMonday = (date.getUTCDay() + 6) % 7; // Sun=0..Sat=6 -> Mon=0..Sun=6
  return addDaysUTC(date, -daysSinceMonday);
}

function formatFullDate(date: Date): string {
  const weekday = WEEKDAY_FULL[(date.getUTCDay() + 6) % 7];
  return `${weekday}, ${MONTH_ABBR[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function formatWeekRange(monday: Date, sunday: Date): string {
  const start = `${MONTH_ABBR[monday.getUTCMonth()]} ${monday.getUTCDate()}`;
  const end =
    monday.getUTCMonth() === sunday.getUTCMonth()
      ? `${sunday.getUTCDate()}`
      : `${MONTH_ABBR[sunday.getUTCMonth()]} ${sunday.getUTCDate()}`;
  return `${start}–${end}`;
}

// Mirrors cal-heatmap's own Legend.prototype.getClass: given options.legend
// (a threshold array built on the Python side as
// [-maxForecast, ..., -minForecast, 0, minHistory, ..., maxHistory]),
// find the first threshold the value doesn't exceed and return the
// matching "r<N> q<N>" class pair. Those class names are exactly what
// review-heatmap.css already styles per color theme, so cell coloring
// stays perfectly consistent with the regular cal-heatmap-driven views.
function legendClassFor(value: number, legend: number[]): string {
  if (!value) {
    return "";
  }
  for (let i = 0; i < legend.length; i++) {
    if (value <= legend[i]) {
      return `r${i + 1} q${i + 1}`;
    }
  }
  return `r${legend.length} q${legend.length}`;
}

interface WeekRowsState {
  data: ReviewHeatmapData;
  weeksPerPage: number;
  pageOffset: number; // 0 = most recent page (starts at today's week)
}

class ReviewHeatmap {
  private heatmap: CalHeatMap | null;
  private weekRowsState: WeekRowsState | null;

  constructor(private options: ReviewHeatmapOptions) {
    this.heatmap = null;
    this.weekRowsState = null;
  }

  public create(data: ReviewHeatmapData) {
    if (this.options.domain === "week") {
      this.weekRowsState = {
        data: data,
        weeksPerPage: this.options.range,
        pageOffset: 0,
      };
      this.renderWeekRows();
      return;
    }

    let calStartDate = applyDateOffset(new Date());
    let calMinDate = applyDateOffset(new Date(this.options.start));
    let calMaxDate = applyDateOffset(new Date(this.options.stop));
    let calTodayDate = applyDateOffset(new Date(this.options.today));

    // Running overview of 6-month activity in month view:
    if (this.options.domain === "month") {
      let padding = this.options.range / 2;
      // TODO: fix
      let paddingLower = Math.round(padding - 1);
      let paddingUpper = Math.round(padding + 1);

      calStartDate.setMonth(calStartDate.getMonth() - paddingLower);
      calStartDate.setDate(1);

      // Start at first data point if history < 6 months
      if (calMinDate.getTime() > calStartDate.getTime()) {
        calStartDate = calMinDate;
      }

      let tempDate = new Date(calTodayDate);
      tempDate.setMonth(tempDate.getMonth() + paddingUpper);
      tempDate.setDate(1);

      // Always go back to centered view after scrolling back then forward
      if (tempDate.getTime() > calMaxDate.getTime()) {
        calMaxDate = tempDate;
      }
    }

    let heatmap = new CalHeatMap();

    // console.log("Date: options.today " + new Date(options.today))
    // console.log("Date: calTodayDate "+ calTodayDate)
    // console.log("Date: Date() "+ new Date())

    heatmap.init({
      domain: this.options.domain,
      subDomain: this.options.subdomain,
      range: this.options.range,
      minDate: calMinDate,
      maxDate: calMaxDate,
      cellSize: 10,
      verticalOrientation: false,
      dayLabel: true,
      domainMargin: [1, 1, 1, 1],
      itemName: ["card", "cards"],
      highlight: calTodayDate,
      today: calTodayDate,
      start: calStartDate,
      legend: this.options.legend,
      displayLegend: false,
      domainLabelFormat: this.options.domLabForm,
      tooltip: true,
      subDomainTitleFormat: (
        isEmpty: boolean,
        formatData: CalHeatmapFormatData,
        cellData: CalHeatmapCellData
      ): string => {
        // format tooltips
        let tooltip: string;

        let count = formatData.count;
        if (count !== undefined && count.startsWith("-")) {
          count = count.substring(1);
        }

        if (isEmpty) {
          tooltip = `<b>No</b> ${
            Date.now() < cellData.t ? "cards due" : "reviews"
          } on ${formatData.date}`;
        } else {
          const label = Math.abs(cellData.v) == 1 ? "card" : "cards";
          tooltip = `<b>${count}</b> ${label} <b>${
            cellData.v < 0 ? "due" : "reviewed"
          }</b> ${formatData.connector} ${formatData.date}`;
        }

        return tooltip;
      },
      onClick: (date, nb) => {
        // Click handler that shows cards assigned to a particular date
        // in Anki's card browser

        if (nb === null || nb == 0) {
          // No cards for that day. Preserve highlight and return.
          heatmap.highlight(calTodayDate);
          return;
        }

        bridgeCommand(
          "revhm_browse:" + this.buildBrowserSearchCommand(date, nb)
        );

        // Update date highlight to include clicked on date AND today
        heatmap.highlight([calTodayDate, date]);
      },
      afterLoadData: function afterLoadData(timestamps: string[]) {
        // Cal-heatmap always uses the local timezone, which is problematic
        // when supplying UTC start-of-day times.
        //
        // This workaround updates the supplied timestamps to force
        // cal-heatmap to display times in UTC. E.g.:
        //   - input datetime (UTC): 2018-01-02 00:00:00 UTC+0000 (UTC)
        //   - cal-heatmap datetime: 2018-01-01 20:00:00 UTC-0400 (EDT)
        //   - workaround datetime:  2018-01-02 00:00:00 UTC-0400 (EDT)
        //
        // Please note that this change will skew any programmatic data
        // output from cal-heatmap, e.g. when implementing an onClick
        // handler. You will have to take the updated datetime into
        // account in that case.
        //
        // cf.: https://github.com/wa0x6e/cal-heatmap/issues/122
        //      https://github.com/wa0x6e/cal-heatmap/issues/126
        let results = {};
        for (let timestamp_string in timestamps) {
          let value = timestamps[timestamp_string];
          let timestamp = parseInt(timestamp_string, 10);
          results[timestamp + tzOffsetByTimestamp(timestamp)] = value;
        }
        return results;
      },
      data: data,
    });

    this.heatmap = heatmap;
  }

  // Shared by both the cal-heatmap onClick handler above and the week-rows
  // day-cell click handler below, so the two views always build the exact
  // same browser search for a given date/value pair.
  private buildBrowserSearchCommand(date: Date, value: number): string {
    let cmd = this.options.whole ? "" : "deck:current ";

    let today = utcMidnight(new Date(this.options.today));
    let diffSecs = Math.abs(today.getTime() - date.getTime()) / 1000;
    let diffDays = Math.round(diffSecs / 86400);

    if (value >= 0) {
      // Review log
      // @ts-expect-error
      if (!window.rhNewFinderAPI) {
        // Use custom finder based on revlog ID range
        let cutoff1 = date.getTime() + this.options.offset * 3600 * 1000;
        let cutoff2 = cutoff1 + 86400 * 1000;
        cmd += "rid:" + cutoff1 + ":" + cutoff2;
      } else {
        cmd += "prop:rated=" + (diffDays ? -diffDays : 0);
      }
    } else {
      // Forecast
      cmd += "prop:due=" + diffDays;
    }

    return cmd;
  }

  private renderWeekRows() {
    const state = this.weekRowsState;
    const container = document.getElementById("cal-heatmap");
    if (!state || !container) {
      return;
    }

    const cellSize = 22;
    const cellGap = 4;
    const rowHeight = cellSize + 10;
    const headerHeight = 20;
    const labelWidth = 130;
    const gridWidth = 7 * (cellSize + cellGap) - cellGap;
    const width = labelWidth + gridWidth + 4;
    const height = headerHeight + state.weeksPerPage * rowHeight + 4;

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "cal-heatmap-container week-rows-graph");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));

    for (let col = 0; col < 7; col++) {
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute(
        "x",
        String(labelWidth + col * (cellSize + cellGap) + cellSize / 2)
      );
      text.setAttribute("y", String(headerHeight - 6));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("class", "graph-label");
      text.textContent = WEEKDAY_ABBR[col];
      svg.appendChild(text);
    }

    const today = utcMidnight(new Date(this.options.today));
    const thisWeekMonday = mondayOfUTC(today);
    const rangeStart =
      this.options.start !== null ? utcMidnight(new Date(this.options.start)) : null;
    const rangeStop =
      this.options.stop !== null ? utcMidnight(new Date(this.options.stop)) : null;

    for (let row = 0; row < state.weeksPerPage; row++) {
      const weeksBack = state.pageOffset * state.weeksPerPage + row;
      const weekMonday = addDaysUTC(thisWeekMonday, -weeksBack * 7);
      const weekSunday = addDaysUTC(weekMonday, 6);
      const y = headerHeight + row * rowHeight;
      const isCurrentWeek = weeksBack === 0;

      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", String(labelWidth - 10));
      label.setAttribute("y", String(y + cellSize / 2 + 4));
      label.setAttribute("text-anchor", "end");
      label.setAttribute(
        "class",
        "graph-label week-rows-row-label" + (isCurrentWeek ? " current" : "")
      );
      label.textContent = formatWeekRange(weekMonday, weekSunday);
      svg.appendChild(label);

      for (let col = 0; col < 7; col++) {
        const day = addDaysUTC(weekMonday, col);
        const ts = day.getTime();
        const x = labelWidth + col * (cellSize + cellGap);

        const inRange =
          (rangeStart === null || ts >= rangeStart.getTime()) &&
          (rangeStop === null || ts <= rangeStop.getTime());

        // The data dict's keys are plain unix epoch *seconds* (the
        // convention cal-heatmap's own data-loading expects, see
        // tzOffsetByTimestamp below), while ts here is milliseconds like
        // options.today/start/stop -- convert before looking anything up,
        // or every lookup silently misses.
        const rawValue = (state.data as { [key: number]: unknown })[
          Math.round(ts / 1000)
        ];
        const value = (Array.isArray(rawValue) ? rawValue[0] : rawValue) as
          | number
          | undefined;
        const hasValue = inRange && value !== undefined && value !== null;

        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", String(x));
        rect.setAttribute("y", String(y));
        rect.setAttribute("width", String(cellSize));
        rect.setAttribute("height", String(cellSize));
        rect.setAttribute("rx", "3");

        let className = "graph-rect";
        if (hasValue) {
          className += " " + legendClassFor(value as number, this.options.legend);
        }
        if (ts === today.getTime()) {
          className += " highlight-now";
        }
        className += inRange ? " hover_cursor" : " week-rows-outside-range";
        rect.setAttribute("class", className.trim());

        if (inRange) {
          const title = document.createElementNS(SVG_NS, "title");
          const cellValue = hasValue ? (value as number) : 0;
          title.textContent = this.weekRowsTooltip(day, cellValue);
          rect.appendChild(title);

          if (cellValue) {
            rect.addEventListener("click", () => {
              bridgeCommand(
                "revhm_browse:" + this.buildBrowserSearchCommand(day, cellValue)
              );
            });
          }
        }

        svg.appendChild(rect);
      }
    }

    container.innerHTML = "";
    container.appendChild(svg);
  }

  private weekRowsTooltip(date: Date, value: number): string {
    const dateStr = formatFullDate(date);
    if (!value) {
      return `No ${date.getTime() > Date.now() ? "cards due" : "reviews"} on ${dateStr}`;
    }
    const count = Math.abs(value);
    const label = count === 1 ? "card" : "cards";
    const verb = value < 0 ? "due" : "reviewed";
    return `${count} ${label} ${verb} on ${dateStr}`;
  }

  public onHmHome(event: KeyboardEvent, button) {
    if (event.shiftKey) {
      bridgeCommand("revhm_modeswitch");
      return;
    }
    if (this.weekRowsState) {
      this.weekRowsState.pageOffset = 0;
      this.renderWeekRows();
      return;
    }
    this.heatmap.rewind();
  }

  public onHmNavigate(
    event: KeyboardEvent,
    button,
    direction: "next" | "prev"
  ) {
    if (this.weekRowsState) {
      if (direction === "next") {
        this.weekRowsState.pageOffset = Math.max(
          0,
          this.weekRowsState.pageOffset - 1
        );
      } else {
        this.weekRowsState.pageOffset += 1;
      }
      this.renderWeekRows();
      return;
    }

    if (direction === "next") {
      if (event.shiftKey) {
        this.heatmap.jumpTo(this.heatmap.options.maxDate, false); // shift-click to jump to limit
      } else {
        this.heatmap.next(this.heatmap.options.range);
      }
    } else {
      if (event.shiftKey) {
        this.heatmap.jumpTo(this.heatmap.options.minDate, false); // shift-click to jump to limit
      } else {
        this.heatmap.previous(this.heatmap.options.range);
      }
    }
  }

  public onHmOpts(event: KeyboardEvent, button) {
    if (event.shiftKey) {
      bridgeCommand("revhm_themeswitch");
    } else {
      bridgeCommand("revhm_opts");
    }
  }

  public onHmContrib(event, button) {
    if (event.shiftKey) {
      bridgeCommand("revhm_snanki");
    } else {
      bridgeCommand("revhm_contrib");
    }
  }

  public onHmExport(event: MouseEvent, button): void {
    const svgElement = document.querySelector("#cal-heatmap svg");

    if (!svgElement) {
      return;
    }

    const serialized = new XMLSerializer().serializeToString(svgElement);
    bridgeCommand("revhm_export:" + encodeURIComponent(serialized));
  }
}

// return "zero"-ed local datetime (workaround for lack of UTC time support
// in cal-heatmap)
function applyDateOffset(date: Date): Date {
  return new Date(date.getTime() + date.getTimezoneOffset() * 60 * 1000);
}

// return local timezone offset in seconds at given unix timestamp
function tzOffsetByTimestamp(timestamp: number): number {
  let date = new Date(timestamp * 1000);
  return date.getTimezoneOffset() * 60;
}

globalThis.ReviewHeatmap = ReviewHeatmap;
