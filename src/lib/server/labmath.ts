/**
 * The arithmetic and the judgement rules behind a laboratory result.
 *
 * Everything here exists to stop a number being interpreted wrongly. Four
 * distinct failures, each of which has harmed patients in real laboratories:
 *
 *  1. **The wrong reference range.** A haemoglobin of 12.5 g/dL is unremarkable
 *     in an adult woman and anaemic in an adult man; 12.5 in a newborn is a
 *     different matter again. One range per analyte guarantees a wrong answer
 *     for somebody.
 *
 *  2. **A typing mistake read as a crisis.** "145" entered for a haemoglobin
 *     meant as 14.5 is not a critical result, it is a slipped decimal point. If
 *     the software treats it as critical it starts a call-the-doctor cascade
 *     over a keystroke — and worse, teaches everyone to distrust critical
 *     alerts.
 *
 *  3. **A result from the wrong patient.** The single most useful control a
 *     laboratory has is the delta check: if this potassium is wildly different
 *     from the same patient's potassium a few hours ago, the likeliest
 *     explanation is that the sample was mislabelled. The technician must be
 *     made to confirm before the result reaches a chart.
 *
 *  4. **Derived values calculated by hand.** eGFR, anion gap, corrected calcium
 *     and LDL are arithmetic on other results. Typed by a person they are a
 *     source of error; computed here they are reproducible, and they carry the
 *     conditions under which the formula is not valid.
 *
 * None of this interprets the result clinically or suggests a diagnosis. It
 * decides which published range applies, whether a number is arithmetically
 * possible, and whether a human should look again before it is filed.
 */

export type Sex = "male" | "female" | "any";

export interface RangeDef {
  refLow: number | null;
  refHigh: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  refText: string;
  appliesSex: Sex;
  ageMinYears: number | null;
  ageMaxYears: number | null;
}

export interface AnalyteRules extends RangeDef {
  code: string;
  name: string;
  unit: string;
  /** Outside these, the value is a data-entry error rather than a result. */
  plausibleLow: number | null;
  plausibleHigh: number | null;
  /** A change larger than either of these from the patient's own last result is queried. */
  deltaAbs: number | null;
  deltaPct: number | null;
  /** Non-empty when the platform computes this analyte from others. */
  derivedFrom: string;
  decimals: number;
}

export interface PatientContext {
  sex: string | null;
  ageYears: number | null;
}

/* ------------------------------------------------------------------ */
/* choosing the range that applies to this patient                     */
/* ------------------------------------------------------------------ */

/**
 * Pick the reference range for this patient from the ranges published for the
 * analyte.
 *
 * Most specific wins: a range naming the patient's sex beats a general one, and
 * a range naming an age band beats one without. When nothing matches — an
 * unknown sex, an age outside every published band — the general range is used
 * and the caller is told, so the report can say the range is generic rather than
 * silently implying it was chosen for this person.
 */
export function pickRange(
  ranges: RangeDef[],
  patient: PatientContext,
): { range: RangeDef | null; specific: boolean; note: string } {
  if (!ranges.length) return { range: null, specific: false, note: "" };

  const sex = normaliseSex(patient.sex);
  const age = patient.ageYears;

  const matches = ranges.filter((r) => {
    if (r.appliesSex !== "any" && r.appliesSex !== sex) return false;
    if (r.ageMinYears !== null && (age === null || age < r.ageMinYears)) return false;
    if (r.ageMaxYears !== null && (age === null || age >= r.ageMaxYears)) return false;
    return true;
  });

  if (!matches.length) {
    const generic = ranges.find((r) => r.appliesSex === "any" && r.ageMinYears === null && r.ageMaxYears === null) ?? ranges[0];
    return {
      range: generic,
      specific: false,
      note:
        sex === "any"
          ? "General reference range used — the patient's sex is not recorded."
          : "General reference range used — no published range matches this patient's age.",
    };
  }

  /*
   * Age outranks sex, and it is not close.
   *
   * A range published for children applies to a child whatever an adult range
   * says about their sex — scoring sex higher would hand an eight-year-old boy
   * the adult male haemoglobin range and call his normal 12.5 g/dL anaemic.
   * Among the ranges that match the patient's age, the sex-specific one wins.
   */
  const scored = matches
    .map((r) => ({
      r,
      score: (r.ageMinYears !== null || r.ageMaxYears !== null ? 4 : 0) + (r.appliesSex !== "any" ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  return { range: scored[0].r, specific: scored[0].score > 0, note: "" };
}

function normaliseSex(s: string | null): Sex {
  const v = (s ?? "").toLowerCase();
  if (v === "male" || v === "m") return "male";
  if (v === "female" || v === "f") return "female";
  return "any";
}

/* ------------------------------------------------------------------ */
/* flagging                                                            */
/* ------------------------------------------------------------------ */

export type ResultFlag = "NORMAL" | "LOW" | "HIGH" | "CRITICAL_LOW" | "CRITICAL_HIGH" | "ABNORMAL";

/** Critical thresholds take priority over the ordinary reference band. */
export function flagForRange(value: number | null, r: RangeDef | null): ResultFlag {
  if (value === null || !r) return "NORMAL";
  if (r.criticalLow !== null && value <= r.criticalLow) return "CRITICAL_LOW";
  if (r.criticalHigh !== null && value >= r.criticalHigh) return "CRITICAL_HIGH";
  if (r.refLow !== null && value < r.refLow) return "LOW";
  if (r.refHigh !== null && value > r.refHigh) return "HIGH";
  return "NORMAL";
}

export function isCriticalFlag(flag: ResultFlag): boolean {
  return flag === "CRITICAL_LOW" || flag === "CRITICAL_HIGH";
}

/* ------------------------------------------------------------------ */
/* plausibility — is this a result or a typing mistake?                */
/* ------------------------------------------------------------------ */

export interface Implausible {
  reason: string;
  suggestion: string;
}

/**
 * Reject values that are not physiologically possible.
 *
 * Returns null when the value is acceptable. The suggestion names the likely
 * mistake, because "145 is out of range" is far less useful to a technician at
 * 2am than "did you mean 14.5?".
 */
export function checkPlausible(value: number | null, a: AnalyteRules): Implausible | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) {
    return { reason: `${a.name} must be a number`, suggestion: "" };
  }
  if (value < 0 && (a.plausibleLow === null || a.plausibleLow >= 0)) {
    return { reason: `${a.name} cannot be negative`, suggestion: "" };
  }
  const low = a.plausibleLow;
  const high = a.plausibleHigh;
  if (low !== null && value < low) {
    return {
      reason: `${value} ${a.unit} is below the lowest value this assay can produce (${low} ${a.unit})`,
      suggestion: decimalSlip(value, low, high, a),
    };
  }
  if (high !== null && value > high) {
    return {
      reason: `${value} ${a.unit} is above the highest value this assay can produce (${high} ${a.unit})`,
      suggestion: decimalSlip(value, low, high, a),
    };
  }
  return null;
}

/** "Did you mean…" for the commonest data-entry error: a misplaced decimal. */
function decimalSlip(value: number, low: number | null, high: number | null, a: AnalyteRules): string {
  for (const factor of [10, 100, 0.1, 0.01]) {
    const candidate = value * factor;
    const withinLow = low === null || candidate >= low;
    const withinHigh = high === null || candidate <= high;
    if (withinLow && withinHigh) {
      return `Did you mean ${trim(candidate, a.decimals)} ${a.unit}?`;
    }
  }
  return "";
}

const trim = (n: number, dp: number) => Number(n.toFixed(dp)).toString();

/* ------------------------------------------------------------------ */
/* delta check — is this result from this patient?                     */
/* ------------------------------------------------------------------ */

export interface DeltaWarning {
  message: string;
  previousValue: number;
  previousAt: string;
  changeAbs: number;
  changePct: number;
}

/**
 * Compare against the patient's own previous result for the same analyte.
 *
 * A large unexplained swing is more often a mislabelled sample than a real
 * physiological change, which is why this is the laboratory's standard guard
 * against results reaching the wrong chart. It warns; it does not block, because
 * genuine dramatic changes happen and a technician who has checked the sample
 * must be able to proceed.
 */
export function checkDelta(
  value: number | null,
  previous: { valueNum: number | null; at: string } | null,
  a: AnalyteRules,
): DeltaWarning | null {
  if (value === null || !previous || previous.valueNum === null) return null;
  if (a.deltaAbs === null && a.deltaPct === null) return null;

  const prev = previous.valueNum;
  const changeAbs = Math.abs(value - prev);
  const changePct = prev === 0 ? Infinity : Math.abs((value - prev) / prev) * 100;

  const breachAbs = a.deltaAbs !== null && changeAbs >= a.deltaAbs;
  const breachPct = a.deltaPct !== null && changePct >= a.deltaPct;
  if (!breachAbs && !breachPct) return null;

  return {
    message:
      `${a.name} has changed from ${trim(prev, a.decimals)} to ${trim(value, a.decimals)} ${a.unit} ` +
      `(${changePct === Infinity ? "a very large" : `${changePct.toFixed(0)}%`} change). ` +
      `Confirm the sample belongs to this patient before filing.`,
    previousValue: prev,
    previousAt: previous.at,
    changeAbs,
    changePct,
  };
}

/* ------------------------------------------------------------------ */
/* derived values — computed, never typed                              */
/* ------------------------------------------------------------------ */

export interface DerivedDef {
  code: string;
  name: string;
  unit: string;
  /** Analyte codes this needs; all must be present for it to compute. */
  requires: string[];
  decimals: number;
  /**
   * Returns the value, or a reason it cannot be computed. Returning a reason is
   * the point: a formula applied outside its validity is worse than no value.
   */
  compute: (
    v: Record<string, number>,
    patient: PatientContext,
  ) => { value: number } | { unavailable: string };
}

export const DERIVED: DerivedDef[] = [
  {
    code: "EGFR",
    name: "eGFR (CKD-EPI 2021)",
    unit: "mL/min/1.73m²",
    requires: ["CREAT"],
    decimals: 0,
    compute: (v, p) => {
      const scr = v.CREAT;
      if (p.ageYears === null) return { unavailable: "Age is not recorded, and eGFR cannot be estimated without it." };
      if (p.ageYears < 18) return { unavailable: "This formula is for adults; a paediatric estimate needs a different equation." };
      const sex = normaliseSex(p.sex);
      if (sex === "any") return { unavailable: "Sex is not recorded, and the equation needs it." };
      if (scr <= 0) return { unavailable: "Creatinine must be greater than zero." };

      /*
       * CKD-EPI 2021, the race-free equation.
       *   eGFR = 142 × min(Scr/κ,1)^α × max(Scr/κ,1)^-1.200 × 0.9938^age × 1.012 [if female]
       */
      const kappa = sex === "female" ? 0.7 : 0.9;
      const alpha = sex === "female" ? -0.241 : -0.302;
      const ratio = scr / kappa;
      const value =
        142 *
        Math.pow(Math.min(ratio, 1), alpha) *
        Math.pow(Math.max(ratio, 1), -1.2) *
        Math.pow(0.9938, p.ageYears) *
        (sex === "female" ? 1.012 : 1);
      return { value };
    },
  },
  {
    code: "AGAP",
    name: "Anion gap",
    unit: "mmol/L",
    requires: ["NA", "K"],
    decimals: 1,
    /* Na + K − Cl − HCO3. Chloride and bicarbonate are not in this catalogue,
       so the potassium-inclusive two-term form is not computable; report why
       rather than printing a number that looks like an anion gap and is not. */
    compute: (v) =>
      v.CL === undefined || v.HCO3 === undefined
        ? { unavailable: "Chloride and bicarbonate are needed; they are not part of this panel." }
        : { value: v.NA + v.K - v.CL - v.HCO3 },
  },
  {
    code: "CACORR",
    name: "Corrected calcium",
    unit: "mg/dL",
    requires: ["CA", "ALB"],
    decimals: 2,
    /* Payne: measured Ca + 0.8 × (4.0 − albumin g/dL). */
    compute: (v) => ({ value: v.CA + 0.8 * (4.0 - v.ALB) }),
  },
  {
    code: "LDLCALC",
    name: "LDL Cholesterol (calculated)",
    unit: "mg/dL",
    requires: ["CHOL", "HDL", "TG"],
    decimals: 0,
    compute: (v) => {
      /*
       * Friedewald: LDL = TC − HDL − TG/5.
       *
       * It is not valid above a triglyceride of 400 mg/dL, where it
       * underestimates LDL — the classic case of a formula quietly producing a
       * reassuring number for a patient who is not reassuring.
       */
      if (v.TG > 400) {
        return { unavailable: "Triglycerides above 400 mg/dL — the Friedewald calculation is not valid; a direct LDL is required." };
      }
      return { value: v.CHOL - v.HDL - v.TG / 5 };
    },
  },
];

/** Compute every derived analyte whose inputs are present. */
export function computeDerived(
  values: Record<string, number>,
  patient: PatientContext,
): { code: string; name: string; unit: string; value: number | null; decimals: number; unavailable: string }[] {
  const out: { code: string; name: string; unit: string; value: number | null; decimals: number; unavailable: string }[] = [];
  for (const d of DERIVED) {
    if (!d.requires.every((c) => typeof values[c] === "number" && Number.isFinite(values[c]))) continue;
    const r = d.compute(values, patient);
    out.push({
      code: d.code,
      name: d.name,
      unit: d.unit,
      decimals: d.decimals,
      value: "value" in r ? Number(r.value.toFixed(d.decimals)) : null,
      unavailable: "unavailable" in r ? r.unavailable : "",
    });
  }
  return out;
}
