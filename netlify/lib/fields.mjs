// Input validation. Every value from the browser is checked here before it reaches the database.
import { HttpError } from './http.mjs';

const snake = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
export const col = snake;

function isRealDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[1] >= 2000 && +m[1] <= 2100;
}
export const todayUtc = () => new Date().toISOString().slice(0, 10);

// Cleans one value according to its rule. Returns the clean value, or throws a string message.
function cleanValue(v, rule) {
  const blank = v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  if (blank) {
    if (rule.required) throw 'This is required.';
    if (rule.kind === 'cents' || rule.kind === 'date' || rule.nullable) return null;
    if (rule.kind === 'decimal') return rule.default !== undefined ? rule.default : null;
    if (rule.kind === 'bool') return false;
    if (rule.kind === 'int') return rule.default !== undefined ? rule.default : 0;
    if (rule.kind === 'textlist') return [];
    return rule.default !== undefined ? rule.default : '';
  }
  switch (rule.kind) {
    case 'text': {
      if (typeof v !== 'string') throw 'Enter text.';
      let s = v.replace(/\u0000/g, '').replace(/\r\n/g, '\n');
      s = rule.multiline ? s.trim() : s.replace(/\s+/g, ' ').trim();
      if (s.length > (rule.max || 200)) throw `Keep this under ${rule.max || 200} characters.`;
      return s;
    }
    case 'cents': {
      const n = typeof v === 'number' ? v : (/^-?\d+$/.test(String(v).trim()) ? Number(v) : NaN);
      if (!Number.isInteger(n)) throw 'Enter an amount in whole cents.';
      if (n < (rule.min ?? 0)) throw rule.min > 0 ? 'The amount must be more than zero.' : 'The amount cannot be negative.';
      if (n > 99_999_999_999) throw 'That amount is too large.';
      return n;
    }
    case 'decimal': {
      const s = String(v).trim();
      if (!/^\d{1,11}(\.\d+)?$/.test(s)) throw 'Enter a number.';
      const [i, f = ''] = s.split('.');
      if (f.length > rule.scale) throw `Use at most ${rule.scale} decimal places.`;
      const out = `${i}.${f.padEnd(rule.scale, '0')}`;
      if (rule.min !== undefined && Number(out) < rule.min) throw `Must be at least ${rule.min}.`;
      if (rule.max !== undefined && Number(out) > rule.max) throw `Must be ${rule.max} or less.`;
      return out;
    }
    case 'date': {
      const s = String(v).trim();
      if (!isRealDate(s)) throw 'Enter a valid date.';
      return s;
    }
    case 'enum': {
      if (!rule.values.includes(v)) throw 'Choose one of the listed options.';
      return v;
    }
    case 'bool': return v === true || v === 'true';
    case 'int': {
      const n = Number(v);
      if (!Number.isInteger(n) || n < (rule.min ?? 0) || n > (rule.max ?? 1_000_000)) throw 'Enter a whole number.';
      return n;
    }
    case 'textlist': {
      if (!Array.isArray(v)) throw 'Enter a list.';
      if (v.length > (rule.maxItems || 30)) throw `At most ${rule.maxItems || 30} items.`;
      return v.map((x) => {
        if (typeof x !== 'string') throw 'Each item must be text.';
        const s = x.replace(/\s+/g, ' ').trim();
        if (s.length > (rule.max || 500)) throw `Keep each item under ${rule.max || 500} characters.`;
        return s;
      }).filter(Boolean);
    }
    default: throw 'Unsupported field.';
  }
}

// Cleans `input` against `spec`. Unknown keys are ignored (never written). Collects every error.
export function cleanFields(input, spec) {
  const clean = {}; const errors = {};
  for (const [name, rule] of Object.entries(spec)) {
    try {
      const out = cleanValue(input[name], rule);
      if (out !== undefined) clean[name] = out;
    } catch (msg) {
      if (typeof msg !== 'string') throw msg;
      errors[name] = msg;
    }
  }
  return { clean, errors };
}

export function failIfErrors(errors) {
  if (Object.keys(errors).length) throw new HttpError(400, 'validation', 'Please fix the highlighted fields.', errors);
}
