export interface PortalNavigationRoute {
  readonly title: string;
  readonly urlTemplate: string;
  readonly requiredParams?: readonly string[];
}

/**
 * Central route catalog for links that can be returned by the assistant.
 * Add new portal destinations here; the navigation service resolves templates
 * and required parameters generically.
 */
export const portalNavigationRoutes: Readonly<
  Record<string, PortalNavigationRoute>
> = {
  profile: {
    title: "Profile",
    urlTemplate:
      "https://dev-myportal.american-equity.com/agent/user/profile?activeTab=personalInfo",
  },
  personalInfo: {
    title: "Personal Information",
    urlTemplate:
      "https://helpdesk.aspiresys.com/MDLKnowledgeMgmt/KM_RPT_DashboardAll.aspx",
  },
  banking: {
    title: "Banking",
    urlTemplate:
      "https://dev-myportal.american-equity.com/agent/user/profile?activeTab=banking",
  },
  documents: {
    title: "Documents",
    urlTemplate:
      "https://dev-myportal.american-equity.com/agent/user/profile?activeTab=documents",
  },
  pendingContractDetails: {
    title: "Pending Contract Details",
    urlTemplate:
      "https://dev-myportal.american-equity.com/agent/book-business/pending-contract/{contractId}?activeTab=info",
    requiredParams: ["contractId"],
  },
  contractDetails: {
    title: "Contract Details",
    urlTemplate:
      "https://dev-myportal.american-equity.com/agent/book-business/contract-details/{contractId}?activeTab=info",
    requiredParams: ["contractId"],
  },
  beneficiaries: {
    title: "Beneficiaries",
    urlTemplate:
      "https://dev-myportal.american-equity.com/agent/book-business/contract-details/{contractId}?activeTab=beneficiaries",
    requiredParams: ["contractId"],
  },
};
