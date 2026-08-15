export interface AirtableRecord<T = Record<string, unknown>> {
  id: string;
  createdTime: string;
  fields: T;
}

/** Real Airtable "ID IBO" table fields */
export interface AirtableIboFields {
  Name?: string;
  "Phone IBO"?: string;
  "Phone Perso (Hushed)"?: string;
  "Phone LLC"?: string;
  "🔗 Linked LLCs"?: string[] | string;
  "Linked LLCs"?: string[] | string;
  Status?: string;
  // Legacy / optional mapped names
  ReferenceCode?: string;
  DisplayName?: string;
  ActiveBanksCount?: number;
  BackupBanksCount?: number;
  ActiveMidsCount?: number;
}

/** Real Airtable "LLCs" table fields */
export interface AirtableLlcFields {
  "LLC Name"?: string;
  IBO?: string[] | string;
  EIN?: string;
  States?: string;
  Address?: string;
  "Formation Date (US)"?: string;
  Phone?: string;
  Domain?: string;
  "Desc Business"?: string;
  "Desc Product"?: string;
  Bank?: string[] | string;
  "Statuts Bank"?: string;
  Status?: string;
}

export interface AirtableBankFields {
  Name?: string;
  IboId?: string[];
  Status?: string;
  IsBackup?: boolean;
  OpenedAt?: string;
  ClosedAt?: string;
  FundsAtRisk?: number;
  Notes?: string;
}

export interface AirtableMidFields {
  ReferenceCode?: string;
  IboId?: string[];
  BankId?: string[];
  Status?: string;
  UnderwritingStartedAt?: string;
  ApprovedAt?: string;
  ClosedAt?: string;
  AverageVolume?: number;
  Notes?: string;
}

export interface AirtableSopFields {
  Title?: string;
  Category?: string;
  Summary?: string;
  Objective?: string;
  EstimatedTime?: string;
  Difficulty?: string;
  Owner?: string;
}
