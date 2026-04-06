const escapeCsvCell = (value) => {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

const toCsv = (rows) => {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(escapeCsvCell).join(',')];

  rows.forEach((row) => {
    lines.push(headers.map((header) => escapeCsvCell(row[header])).join(','));
  });

  return lines.join('\n');
};

module.exports = { toCsv };
