/** A configured portal destination. Dynamic segments use `{parameterName}`. */
export interface PortalRoute {
  readonly title: string;
  readonly urlTemplate: string;
}

/**
 * Central catalog of portal destinations exposed by the navigation tool.
 * Add or update destinations here without changing service or tool code.
 */
export const portalRoutes: Readonly<Record<string, PortalRoute>> = {
  profile: {
    title: "Profile",
    urlTemplate:
      "https://dev-myportal.american-equity.com/agent/user/profile?activeTab=personalInfo",
  },
  personalInfo: {
    title: "Personal Information",
    urlTemplate:
      "https://dev-myportal.american-equity.com/agent/user/profile?activeTab=personalInfo",
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
  contractDetails: {
    title: "Contract Details",
    urlTemplate:
      "https://dev-myportal.american-equity.com/agent/book-business/contract-details/{contractId}?activeTab=info",
  },
  beneficiaries: {
    title: "Beneficiaries",
    urlTemplate:
      "https://dev-myportal.american-equity.com/agent/book-business/contract-details/{contractId}?activeTab=beneficiaries",
  },
  pendingContractDetails: {
    title: "Pending Contract Details",
    urlTemplate:
      "https://dev-myportal.american-equity.com/agent/book-business/pending-contract/{contractId}?activeTab=info",
  },
};
