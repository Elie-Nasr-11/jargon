import {
  BookOpen,
  Code2,
  FlaskConical,
  GraduationCap,
  Landmark,
  Music,
  Palette,
  Sigma,
  type LucideIcon,
} from "lucide-react";

// Maps a subject / course / class label to a lucide icon + a soft decorative tint, so a class
// card can signal its subject at a glance with no per-subject data model — pure keyword matching
// over whatever label is available (subject_title, else course_title, else the class name), with
// a neutral GraduationCap default. Tints stay off the "danger" red so a subject never reads as an
// alert; the icon shape does the real differentiating.
export type SubjectIcon = { Icon: LucideIcon; tintClass: string };

const RULES: Array<{ re: RegExp; Icon: LucideIcon; tintClass: string }> = [
  {
    re: /\b(code|coding|comp\s*sci|computer|computing|programming|program|software|jargon|python|javascript|java|html|css)\b/i,
    Icon: Code2,
    tintClass: "text-info",
  },
  {
    re: /\b(math|maths|mathematics|algebra|geometry|calculus|trig(?:onometry)?|statistics|arithmetic|number)\b/i,
    Icon: Sigma,
    tintClass: "text-warning",
  },
  {
    re: /\b(science|biology|chemistry|physics|anatomy|geology|astronomy|lab)\b/i,
    Icon: FlaskConical,
    tintClass: "text-success",
  },
  {
    re: /\b(english|ela|language\s*arts|literature|writing|reading|grammar|spanish|french|german|latin|mandarin|language)\b/i,
    Icon: BookOpen,
    tintClass: "text-info",
  },
  {
    re: /\b(history|social\s*studies|social|geography|civics|government|economics|econ|politics)\b/i,
    Icon: Landmark,
    tintClass: "text-warning",
  },
  {
    re: /\b(art|arts|drawing|painting|design|visual|photography)\b/i,
    Icon: Palette,
    tintClass: "text-success",
  },
  {
    re: /\b(music|band|choir|chorus|orchestra|instrument)\b/i,
    Icon: Music,
    tintClass: "text-info",
  },
];

export function subjectIcon(label: string | null | undefined): SubjectIcon {
  const text = (label ?? "").trim();
  if (text) {
    for (const rule of RULES) {
      if (rule.re.test(text)) return { Icon: rule.Icon, tintClass: rule.tintClass };
    }
  }
  return { Icon: GraduationCap, tintClass: "text-muted-foreground" };
}
