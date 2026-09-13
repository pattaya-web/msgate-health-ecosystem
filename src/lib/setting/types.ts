/**
 * Le setting : un rendez-vous décroché, saisi à la main.
 *
 * Le closing vient d'iClosed, qui tient déjà ses deals. Le setting, lui,
 * n'existe nulle part — un setter décroche un rendez-vous en DM et rien ne
 * l'enregistre. Ces lignes sont donc la source, pas une copie.
 */
export type SettingAppointment = {
  id: string;
  /** Le jour où le rendez-vous a été décroché. */
  setDate: string;
  setterName: string;
  setterInstagram: string;
  /**
   * La lead.
   *
   * Ces trois champs ne sont pas du confort : sans identité de prospect, une
   * ligne de setting ne se rapproche jamais du deal qu'iClosed rendra, et
   * « qui a set la lead que X a closée » reste sans réponse. L'e-mail est la
   * clé la plus sûre, l'@ Instagram le repli.
   */
  leadName: string;
  leadInstagram: string;
  leadEmail: string;
  /** La date du rendez-vous lui-même. */
  appointmentAt: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type SettingAppointmentInput = Omit<SettingAppointment, "id" | "createdAt" | "updatedAt">;

export function defaultAppointment(): SettingAppointmentInput {
  return {
    setDate: new Date().toISOString().slice(0, 10),
    setterName: "",
    setterInstagram: "",
    leadName: "",
    leadInstagram: "",
    leadEmail: "",
    appointmentAt: "",
    notes: "",
  };
}

/**
 * Un @ Instagram se saisit comme il se prononce.
 *
 * « @Mady », « mady », « https://instagram.com/mady/ » désignent le même
 * compte. On garde une seule forme — le pseudo nu, en minuscules — sinon le
 * rapprochement avec iClosed échoue sur une arobase et un slash.
 */
export function normalizeHandle(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}
