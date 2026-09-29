import ExcelJS from 'exceljs';
import { type ExportColumns, exportColumns } from '@/domain';
import { en } from '@/i18n/en';
import { todayISO } from '@/lib/format';
import type { AttendanceMonth } from './attendance';
import { EMS_LOGO_PNG_BASE64 } from './excelLogo';
import type { MonthReport, ReportRow } from './reports';

// Colours of the official EMS timesheet template, so the export looks like the sheet Finance already knows.
const C = {
  bar: 'FF6F6F6E',
  total: 'FF4D4D4C',
  lime: 'FFD7DB46',
  field: 'FFF5F7DE',
  fieldEdge: 'FFB9BE3E',
  entry: 'FFFAFBEF',
  date: 'FFF4F4F2',
  grid: 'FFE2E2DE',
  zebra: 'FFFAFAF9',
  white: 'FFFFFFFF',
  ink: 'FF3F3F3E',
  inkDark: 'FF1F1F1E',
  label: 'FF8C8C89',
  subtle: 'FF9A9A97',
  olive: 'FF8E9427',
  holiday: 'FF6A6E1F',
} as const;

const FONT = 'Arial';
const HOURS = 'General;-General;"–"';
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin = (argb: string): Partial<ExcelJS.Borders> => {
  const side = { style: 'thin' as const, color: { argb } };
  return { top: side, bottom: side, left: side, right: side };
};
const font = (size: number, color: string, bold = false): Partial<ExcelJS.Font> => ({ name: FONT, size, color: { argb: color }, bold });
const hrs = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATUS_FILL: Record<string, string> = { approved: 'FFE5FF95', submitted: 'FFE6ECF8', returned: 'FFFBEBD3', draft: 'FFF4F4F2' };

/** Columns of the daily table, left to right, from column B. */
const DAY_COLS: { key: keyof ExportColumns; head: string }[] = [
  { key: 'client', head: 'Client' },
  { key: 'pl', head: 'PL' },
  { key: 'sl', head: 'SL' },
  { key: 'ph', head: 'PH' },
  { key: 'ot', head: 'OT' },
  { key: 'sot', head: 'SOT' },
  { key: 'other', head: 'Other leave' },
];
const KEY: [string, string][] = [
  ['PL', 'Personal leave (annual)'],
  ['SL', 'Sick leave'],
  ['PH', 'Public holiday - the client is off, so we take the day off too'],
  ['OT', 'Overtime - hours beyond the normal day, and any work on a weekend or client holiday'],
  ['SOT', 'Special overtime - a public holiday in Jordan that we work through, because the client is working'],
];

/** The person's full day in minutes: their longest scheduled day this month (8h30 by default). */
function fullDayMinutes(r: ReportRow): number {
  return Math.max(0, ...r.summary.days.map((d) => d.day.expectedMinutes)) || 510;
}

interface PersonMonth {
  row: ReportRow;
  sheetName: string;
  dayMinutes: number;
  days: (ExportColumns & { date: string })[];
  sum: ExportColumns;
}

function personMonth(row: ReportRow, sheetName: string): PersonMonth {
  const dayMinutes = fullDayMinutes(row);
  const days = row.summary.days.map((d) => ({ date: d.day.date, ...exportColumns(d, dayMinutes) }));
  const sum = { client: 0, pl: 0, sl: 0, other: 0, ph: 0, ot: 0, sot: 0 };
  for (const d of days) for (const k of Object.keys(sum) as (keyof ExportColumns)[]) sum[k] += d[k];
  return { row, sheetName, dayMinutes, days, sum };
}

/** Excel sheet names: at most 31 characters, none of []:*?/\ and unique in the workbook. */
function sheetNames(rows: ReportRow[]): string[] {
  const used = new Set<string>(['summary']);
  return rows.map((r) => {
    const base = r.employee.nameEn.replace(/[[\]:*?/\\']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Employee';
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** Logo, title and month across the top of a sheet, like the template's cover. */
function header(ws: ExcelJS.Worksheet, logo: number, title: string, monthLabel: string, lastCol: number) {
  ws.getRow(1).height = 8;
  ws.getRow(2).height = 30;
  ws.getRow(3).height = 18;
  ws.getRow(4).height = 14;
  ws.addImage(logo, { tl: { col: 1, row: 1 }, ext: { width: 110, height: 48 }, editAs: 'oneCell' });
  const t = ws.getCell(2, 4);
  t.value = title;
  t.font = font(20, C.bar, true);
  t.alignment = { vertical: 'middle' };
  const s = ws.getCell(3, 4);
  s.value = 'Emerging Management Services';
  s.font = font(10, C.subtle);
  const m = ws.getCell(2, lastCol);
  m.value = monthLabel;
  m.font = font(12, C.olive, true);
  m.alignment = { horizontal: 'right', vertical: 'middle' };
}

function sectionBar(ws: ExcelJS.Worksheet, row: number, from: number, to: number, text: string) {
  ws.mergeCells(row, from, row, to);
  const c = ws.getCell(row, from);
  c.value = text;
  c.font = font(11, C.white, true);
  c.fill = fill(C.bar);
  c.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(row).height = 24;
}

function tableHead(ws: ExcelJS.Worksheet, row: number, cells: [number, string, 'left' | 'center'][]) {
  ws.getRow(row).height = 24;
  for (const [col, text, align] of cells) {
    const c = ws.getCell(row, col);
    c.value = text;
    c.font = font(10, C.white, true);
    c.fill = fill(C.bar);
    c.alignment = { horizontal: align, vertical: 'middle', wrapText: true, indent: align === 'left' ? 1 : 0 };
    c.border = { bottom: { style: 'medium', color: { argb: C.lime } } };
  }
}

/** A label and a green field, the way the template shows employee details. */
function field(ws: ExcelJS.Worksheet, row: number, labelCol: [number, number], valueCol: [number, number], label: string, value: ExcelJS.CellValue, computed = false) {
  if (labelCol[1] > labelCol[0]) ws.mergeCells(row, labelCol[0], row, labelCol[1]);
  if (valueCol[1] > valueCol[0]) ws.mergeCells(row, valueCol[0], row, valueCol[1]);
  const l = ws.getCell(row, labelCol[0]);
  l.value = label;
  l.font = font(9, C.label);
  l.alignment = { vertical: 'middle' };
  const v = ws.getCell(row, valueCol[0]);
  v.value = value;
  v.font = font(10, C.ink, true);
  v.fill = fill(computed ? C.date : C.field);
  v.border = thin(computed ? C.grid : C.fieldEdge);
  v.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(row).height = 24;
}

/** One sheet per person: their details, a summary by category and every day of the month. */
function personSheet(wb: ExcelJS.Workbook, logo: number, p: PersonMonth, year: number, month: number, monthLabel: string) {
  const { row: r, dayMinutes } = p;
  const ws = wb.addWorksheet(p.sheetName, {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
  });
  // A: margin · B: day · C–I: hours · J: notes
  ws.columns = [2.4, 16, 13, 9, 9, 9, 9, 9, 11, 42].map((width) => ({ width }));
  const usesOther = p.sum.other > 0;
  if (!usesOther) ws.getColumn(9).hidden = true;
  header(ws, logo, 'Monthly Timesheet', monthLabel, 10);

  sectionBar(ws, 5, 2, 10, 'Employee Details');
  ws.getRow(6).height = 7;
  const L: [number, number] = [2, 2];
  const V: [number, number] = [3, 5];
  const L2: [number, number] = [6, 7];
  const V2: [number, number] = [8, 10];
  const client = r.clients.join(', ') || '—';
  field(ws, 7, L, V, 'Name', r.employee.nameEn);
  field(ws, 7, L2, V2, 'Role', r.employee.jobTitle ?? '—');
  field(ws, 8, L, V, 'Department', r.department?.nameEn ?? '—');
  field(ws, 8, L2, V2, 'Manager', r.manager?.nameEn ?? '—');
  field(ws, 9, L, V, 'Client', client);
  field(ws, 9, L2, V2, 'Status', en.timesheet.status[r.status]);
  field(ws, 10, L, V, 'Month', MONTHS[month - 1]!);
  field(ws, 10, L2, V2, 'Year', String(year));
  field(ws, 11, L, V, 'Working days', r.totals.workingDays);
  field(ws, 11, L2, V2, 'Full day (hours)', hrs(dayMinutes));
  const fullDay = 'H11';
  field(ws, 12, L, V, 'Working hours', { formula: `C11*${fullDay}`, result: r.totals.workingDays * hrs(dayMinutes) }, true);
  ws.getCell('C12').numFmt = 'General';

  // Summary by category; its hours point at the daily totals below, so edits to a day flow up.
  sectionBar(ws, 14, 2, 10, 'Summary');
  tableHead(ws, 15, [
    [2, 'Category', 'left'],
    [3, 'Days', 'center'],
    [4, 'Hours', 'center'],
  ]);
  const firstDay = 19 + DAY_COLS.filter((c) => c.key !== 'other' || usesOther).length;
  const dayRows = p.days.length;
  const totalRow = firstDay + dayRows;
  const colOf = (key: keyof ExportColumns) => 3 + DAY_COLS.findIndex((c) => c.key === key);
  const letter = (col: number) => ws.getColumn(col).letter;
  const categories = DAY_COLS.filter((c) => c.key !== 'other' || usesOther).map((c) => ({
    ...c,
    label: c.key === 'client' ? client : c.key === 'other' ? 'Other leave' : c.head,
  }));
  categories.forEach((c, i) => {
    const rowN = 16 + i;
    const bg = i % 2 ? C.zebra : c.key === 'client' ? C.field : C.white;
    const hoursRef = `${letter(colOf(c.key))}${totalRow}`;
    const cells: [number, ExcelJS.CellValue, 'left' | 'center'][] = [
      [2, c.label, 'left'],
      [3, { formula: `IF(${fullDay}=0,0,D${rowN}/${fullDay})`, result: dayMinutes ? Math.round((p.sum[c.key] / dayMinutes) * 100) / 100 : 0 }, 'center'],
      [4, { formula: hoursRef, result: hrs(p.sum[c.key]) }, 'center'],
    ];
    for (const [col, value, align] of cells) {
      const cell = ws.getCell(rowN, col);
      cell.value = value;
      cell.font = font(10, C.ink, col === 2 || c.key === 'client');
      cell.fill = fill(bg);
      cell.border = thin(C.grid);
      cell.alignment = { horizontal: align, vertical: 'middle', indent: align === 'left' ? 1 : 0 };
      if (col > 2) cell.numFmt = '0.##;-0.##;"–"';
    }
    ws.getRow(rowN).height = 21;
  });

  // Daily table
  const dailyBar = firstDay - 2;
  sectionBar(ws, dailyBar, 2, 10, 'Daily Time Entry');
  tableHead(ws, firstDay - 1, [
    [2, 'Days', 'left'],
    ...DAY_COLS.map((c, i): [number, string, 'center'] => [3 + i, c.key === 'client' ? client : c.head, 'center']),
    [10, 'Notes', 'left'],
  ]);
  ws.getRow(firstDay - 1).height = 32;
  const summaryDays = new Map(r.summary.days.map((d) => [d.day.date, d]));
  p.days.forEach((d, i) => {
    const rowN = firstDay + i;
    const md = summaryDays.get(d.date)!;
    const type = md.day.dayType;
    const off = type === 'weekend' || type === 'unassigned';
    const holiday = type === 'client_holiday' || type === 'special_overtime';
    const leave = md.entry.leave ? `${en.timesheet.leaveTypes[md.entry.leave.type]}${md.entry.leave.portion === 0.5 ? ' (half day)' : ''}` : '';
    const holidayNote = md.day.holidayName ? `${type === 'special_overtime' ? 'Jordan holiday' : 'Public holiday'} – ${md.day.holidayName}` : '';
    const note = [holidayNote, leave, r.notes[d.date] ?? ''].filter(Boolean).join(' · ');
    const dateCell = ws.getCell(rowN, 2);
    const [y, m, dd] = d.date.split('-').map(Number) as [number, number, number];
    dateCell.value = new Date(Date.UTC(y, m - 1, dd));
    dateCell.numFmt = 'ddd d mmm';
    DAY_COLS.forEach((c, j) => {
      ws.getCell(rowN, 3 + j).value = hrs(d[c.key]);
    });
    ws.getCell(rowN, 10).value = note;
    for (let col = 2; col <= 10; col++) {
      const cell = ws.getCell(rowN, col);
      const bg = holiday ? C.field : off ? C.date : col === 2 ? C.date : col === 3 ? C.entry : C.white;
      const color = holiday ? C.holiday : off ? C.subtle : C.inkDark;
      cell.fill = fill(bg);
      cell.font = font(10, color, holiday || col <= 3);
      cell.border = thin(C.grid);
      cell.alignment = { horizontal: col === 2 || col === 10 ? 'left' : 'center', vertical: 'middle', indent: col === 2 || col === 10 ? 1 : 0 };
      if (col > 2 && col < 10) cell.numFmt = HOURS;
    }
    ws.getRow(rowN).height = 18;
  });

  // Total Hrs
  ws.getRow(totalRow).height = 24;
  for (let col = 2; col <= 10; col++) {
    const cell = ws.getCell(totalRow, col);
    if (col === 2) cell.value = 'Total Hrs';
    else if (col < 10) {
      const L = letter(col);
      const key = DAY_COLS[col - 3]!.key;
      cell.value = { formula: `SUM(${L}${firstDay}:${L}${totalRow - 1})`, result: hrs(p.sum[key]) };
      cell.numFmt = '0.##;-0.##;"–"';
    }
    cell.font = font(10, C.white, true);
    cell.fill = fill(C.total);
    cell.alignment = { horizontal: col === 2 ? 'left' : 'center', vertical: 'middle', indent: col === 2 ? 1 : 0 };
  }

  // Key
  let k = totalRow + 2;
  ws.getCell(k, 2).value = 'Key';
  ws.getCell(k, 2).font = font(9, C.bar, true);
  for (const [code, text] of [...KEY, ...(usesOther ? ([['Other', 'Other leave types (e.g. Hajj, unpaid) - see the notes']] as [string, string][]) : [])]) {
    k++;
    ws.getCell(k, 2).value = code;
    ws.getCell(k, 2).font = font(9, C.bar, true);
    ws.getCell(k, 3).value = text;
    ws.getCell(k, 3).font = font(9, C.label);
  }
  k++;
  ws.getCell(k, 2).value = `Days off and holidays follow the client's calendar. A full day is ${hrs(dayMinutes)} hours.`;
  ws.getCell(k, 2).font = font(9, C.label);
  k += 2;
  ws.getCell(k, 2).value = `Generated by EMS People & Culture on ${todayISO()}`;
  ws.getCell(k, 2).font = font(8, C.subtle);
}

/** The first sheet: everyone's month at a glance, each name linking to their own sheet. */
function summarySheet(wb: ExcelJS.Workbook, logo: number, people: PersonMonth[], report: MonthReport, monthLabel: string, title: string) {
  const ws = wb.addWorksheet('Summary', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const cols: { head: string; width: number; align: 'left' | 'center'; hours?: boolean }[] = [
    { head: 'Employee', width: 24, align: 'left' },
    { head: 'Role', width: 22, align: 'left' },
    { head: 'Department', width: 22, align: 'left' },
    { head: 'Manager', width: 18, align: 'left' },
    { head: 'Client', width: 20, align: 'left' },
    { head: 'Status', width: 12, align: 'center' },
    { head: 'Working days', width: 10, align: 'center' },
    { head: 'Client hrs', width: 10, align: 'center', hours: true },
    { head: 'PL hrs', width: 8, align: 'center', hours: true },
    { head: 'SL hrs', width: 8, align: 'center', hours: true },
    { head: 'PH hrs', width: 8, align: 'center', hours: true },
    { head: 'OT hrs', width: 8, align: 'center', hours: true },
    { head: 'SOT hrs', width: 8, align: 'center', hours: true },
    { head: 'Other leave hrs', width: 10, align: 'center', hours: true },
    { head: 'Weighted OT hrs', width: 10, align: 'center', hours: true },
  ];
  const last = cols.length + 1;
  ws.columns = [{ width: 2.4 }, ...cols.map((c) => ({ width: c.width }))];
  header(ws, logo, title, monthLabel, last);
  sectionBar(ws, 5, 2, last, `Team summary · ${people.length} ${people.length === 1 ? 'person' : 'people'}${report.closed ? ' · month closed' : ''}`);
  const headRow = 7;
  tableHead(ws, headRow, cols.map((c, i) => [2 + i, c.head, c.align]));
  ws.getRow(headRow).height = 32;
  ws.views = [{ state: 'frozen', ySplit: headRow, xSplit: 2, showGridLines: false }];

  const columnValues: number[][] = cols.map(() => []);
  people.forEach((p, i) => {
    const rowN = headRow + 1 + i;
    const r = p.row;
    const values: ExcelJS.CellValue[] = [
      { text: r.employee.nameEn, hyperlink: `#'${p.sheetName}'!A1` },
      r.employee.jobTitle ?? '',
      r.department?.nameEn ?? '',
      r.manager?.nameEn ?? '',
      r.clients.join(', '),
      en.timesheet.status[r.status],
      r.totals.workingDays,
      hrs(p.sum.client),
      hrs(p.sum.pl),
      hrs(p.sum.sl),
      hrs(p.sum.ph),
      hrs(p.sum.ot),
      hrs(p.sum.sot),
      hrs(p.sum.other),
      hrs(r.totals.weightedOvertimeMinutes),
    ];
    values.forEach((v, j) => {
      if (typeof v === 'number') columnValues[j]!.push(v);
      const cell = ws.getCell(rowN, 2 + j);
      const col = cols[j]!;
      cell.value = v;
      cell.fill = fill(j === 5 ? (STATUS_FILL[r.status] ?? C.white) : i % 2 ? C.zebra : C.white);
      cell.font = j === 0 ? { ...font(10, C.olive, true), underline: true } : font(10, C.ink, j === 5);
      cell.border = thin(C.grid);
      cell.alignment = { horizontal: col.align, vertical: 'middle', indent: col.align === 'left' ? 1 : 0 };
      if (col.hours) cell.numFmt = HOURS;
    });
    ws.getRow(rowN).height = 20;
  });

  const totalRow = headRow + 1 + people.length;
  ws.getRow(totalRow).height = 24;
  cols.forEach((c, j) => {
    const cell = ws.getCell(totalRow, 2 + j);
    const L = ws.getColumn(2 + j).letter;
    if (j === 0) cell.value = 'Total';
    else if (c.hours || c.head === 'Working days') {
      const result = Math.round(columnValues[j]!.reduce((sum, v) => sum + v, 0) * 100) / 100;
      cell.value = { formula: `SUM(${L}${headRow + 1}:${L}${totalRow - 1})`, result };
      cell.numFmt = '0.##;-0.##;"–"';
    }
    cell.font = font(10, C.white, true);
    cell.fill = fill(C.total);
    cell.alignment = { horizontal: c.align, vertical: 'middle', indent: c.align === 'left' ? 1 : 0 };
  });
  const note = ws.getCell(totalRow + 2, 2);
  note.value = 'Click a name to open that person’s sheet. Hours are decimal (8.5 = 8h 30m).';
  note.font = font(9, C.subtle);
}

const PLACE_NAMES = { office: 'Office', client_site: 'Client site', remote: 'Remote' } as const;

/** Flat day-by-day data for filtering and pivot tables. "Where" is the place chosen at that day's first clock-in. */
function dataSheet(wb: ExcelJS.Workbook, people: PersonMonth[], attendance?: AttendanceMonth) {
  const places = new Map((attendance?.rows ?? []).map((r) => [r.employee.id, new Map(Object.entries(r.places))]));
  const ws = wb.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Employee', key: 'name', width: 24 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Day type', key: 'type', width: 16 },
    { header: 'Client hrs', key: 'client', width: 10 },
    { header: 'PL hrs', key: 'pl', width: 8 },
    { header: 'SL hrs', key: 'sl', width: 8 },
    { header: 'PH hrs', key: 'ph', width: 8 },
    { header: 'OT hrs', key: 'ot', width: 8 },
    { header: 'SOT hrs', key: 'sot', width: 8 },
    { header: 'Other leave hrs', key: 'other', width: 10 },
    { header: 'Leave type', key: 'leave', width: 14 },
    { header: 'Note', key: 'note', width: 40 },
    { header: 'Where', key: 'where', width: 12 },
  ];
  for (const p of people) {
    const byDate = new Map(p.row.summary.days.map((d) => [d.day.date, d]));
    for (const d of p.days) {
      const md = byDate.get(d.date)!;
      const place = places.get(p.row.employee.id)?.get(d.date);
      ws.addRow({
        name: p.row.employee.nameEn,
        date: d.date,
        type: md.day.dayType,
        client: hrs(d.client),
        pl: hrs(d.pl),
        sl: hrs(d.sl),
        ph: hrs(d.ph),
        ot: hrs(d.ot),
        sot: hrs(d.sot),
        other: hrs(d.other),
        leave: md.entry.leave?.type ?? '',
        note: p.row.notes[d.date] ?? '',
        where: place ? PLACE_NAMES[place] : '',
      });
    }
  }
  const head = ws.getRow(1);
  head.font = font(10, C.white, true);
  head.fill = fill(C.bar);
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 28;
  ws.autoFilter = { from: 'A1', to: 'M1' };
}

/** Late, absent and forgotten clock-outs per person, from the clock (see the Attendance tab in Reports). */
function attendanceSheet(wb: ExcelJS.Workbook, attendance: AttendanceMonth) {
  const ws = wb.addWorksheet('Attendance', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Employee', key: 'name', width: 24 },
    { header: 'Department', key: 'dept', width: 22 },
    { header: 'Days in', key: 'daysIn', width: 9 },
    { header: 'Late days', key: 'lateDays', width: 9 },
    { header: 'Late hrs', key: 'lateHrs', width: 9 },
    { header: 'Absent days', key: 'absent', width: 10 },
    { header: 'Forgot to clock out', key: 'forgot', width: 12 },
    { header: 'Office days', key: 'office', width: 10 },
    { header: 'Client-site days', key: 'site', width: 10 },
    { header: 'Remote days', key: 'remote', width: 10 },
    { header: 'Note', key: 'note', width: 28 },
  ];
  for (const r of attendance.rows) {
    const tt = r.totals;
    ws.addRow(
      r.onClock
        ? {
            name: r.employee.nameEn,
            dept: r.department?.nameEn ?? '',
            daysIn: tt.daysIn,
            lateDays: tt.lateDays,
            lateHrs: hrs(tt.lateMinutes),
            absent: tt.absentDays,
            forgot: tt.forgotOut,
            office: tt.places.office,
            site: tt.places.client_site,
            remote: tt.places.remote,
          }
        : { name: r.employee.nameEn, dept: r.department?.nameEn ?? '', note: 'Not using the clock yet' },
    );
  }
  const head = ws.getRow(1);
  head.font = font(10, C.white, true);
  head.fill = fill(C.bar);
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 32;
  ws.autoFilter = { from: 'A1', to: 'K1' };
}

/** The Finance export in the look of the official EMS timesheet: a summary, then one sheet per person. */
export async function buildTimesheetWorkbook(
  report: MonthReport,
  attendance?: AttendanceMonth,
  title = 'Monthly Timesheets',
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EMS People & Culture';
  wb.created = new Date();
  const logo = wb.addImage({ base64: EMS_LOGO_PNG_BASE64, extension: 'png' });
  const monthLabel = `${MONTHS[report.month - 1]} ${report.year}`;
  const names = sheetNames(report.rows);
  const people = report.rows.map((r, i) => personMonth(r, names[i]!));
  summarySheet(wb, logo, people, report, monthLabel, title);
  if (attendance) attendanceSheet(wb, attendance);
  for (const p of people) personSheet(wb, logo, p, report.year, report.month, monthLabel);
  dataSheet(wb, people, attendance);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
