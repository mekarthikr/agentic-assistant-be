# Enterprise API Documentation

Base URL: `https://mock-api-server-seven.vercel.app/api/v1`

---

## Contracts API

### Get All Contracts

**Endpoint:** `GET /contracts`

**Description:** Returns a list of all contracts. Supports filtering by query parameters.

**Filterable Fields:**

- `contractNumber` — Filter by contract number
- `clientName` — Filter by client name (partial match, case-insensitive)
- `productName` — Filter by product name (partial match, case-insensitive)
- `contractStatus` — Filter by status: `Active`, `Inactive`, `Surrendered`
- `taxType` — Filter by tax type: `Qualified`, `Non-Qualified`
- `taxQualification` — Filter by qualification: `IRA`, `ROTH IRA`, `NON-QUAL`
- `distributionCompany` — Filter by distribution company

**Example Requests:**

```
GET /contracts
GET /contracts?contractStatus=Active
GET /contracts?taxType=Qualified
GET /contracts?productName=ASSETSHIELD 5
GET /contracts?contractStatus=Active&taxType=Qualified
```

**Response:**

```json
{
  "success": true,
  "message": "Request successful",
  "data": [
    {
      "contractNumber": "1561091",
      "clientName": "NETTING AETEST",
      "productName": "AMERICAN EQUITY ASSETSHIELD 5 FIXED INDEX ANNUITY",
      "issuedDate": "2026-06-17T05:00:00+00:00",
      "currentValue": 0,
      "anniversaryDate": "2027-06-17T05:00:00+00:00",
      "taxType": "Qualified",
      "contractStatus": "Active",
      "taxQualification": "IRA",
      "distributionCompany": "AELife"
    }
  ],
  "timestamp": "2026-07-27T12:00:00.000Z"
}
```

---

### Get Contract by Number

**Endpoint:** `GET /contracts/:contractNumber`

**Description:** Returns a single contract by its contract number.

**Path Parameters:**

- `contractNumber` (string, required) — The contract number

**Example Request:**

```
GET /contracts/1561091
```

**Success Response:**

```json
{
  "success": true,
  "message": "Request successful",
  "data": {
    "contractNumber": "1561091",
    "clientName": "NETTING AETEST",
    "productName": "AMERICAN EQUITY ASSETSHIELD 5 FIXED INDEX ANNUITY",
    "issuedDate": "2026-06-17T05:00:00+00:00",
    "currentValue": 0,
    "anniversaryDate": "2027-06-17T05:00:00+00:00",
    "taxType": "Qualified",
    "contractStatus": "Active",
    "taxQualification": "IRA",
    "distributionCompany": "AELife"
  },
  "timestamp": "2026-07-27T12:00:00.000Z"
}
```

**Not Found Response (404):**

```json
{
  "success": false,
  "message": "Contract 9999999 not found",
  "data": null,
  "timestamp": "2026-07-27T12:00:00.000Z"
}
```

---

## Applications API

### Get All Applications

**Endpoint:** `GET /applications`

**Description:** Returns a list of all applications. Supports filtering by query parameters.

**Filterable Fields:**

- `clientName` — Filter by client name (partial match, case-insensitive)
- `product` — Filter by product name (partial match, case-insensitive)
- `taxType` — Filter by tax type: `Qualified`, `Non-Qualified`
- `status` — Filter by status: `In Progress`, `Submitted`, `Approved`, `Rejected`
- `contractNumber` — Filter by contract number
- `productId` — Filter by product ID
- `agentNumber` — Filter by agent number
- `contactId` — Filter by contact ID
- `applicationName` — Filter by application name (partial match, case-insensitive)
- `startDate` — Filter by start date (partial match, e.g., `2026-07-15`)

**Example Requests:**

```
GET /applications
GET /applications?status=In Progress
GET /applications?product=ESTATESHIELD
GET /applications?agentNumber=2026
GET /applications?applicationName=JOHNSON
GET /applications?startDate=2026-07
GET /applications?status=Approved&taxType=Qualified
```

**Response:**

```json
{
  "success": true,
  "message": "Request successful",
  "data": [
    {
      "clientName": "sdf sdf",
      "product": "AMERICAN EQUITY ESTATESHIELD 10 FIXED INDEX ANNUITY",
      "anticipatedPremium": 99999,
      "startDate": "2026-07-15T13:27:11.782+00:00",
      "taxType": "Non-Qualified",
      "status": "In Progress",
      "contractNumber": "1561438",
      "productId": "I-ESTATE24",
      "agentNumber": "2026",
      "applicationLink": "https://american-equity-uatx.unqork.io/app/application#/display/application?id=6a5789ec1ce36757d331b5b8",
      "contactId": "482354",
      "applicationName": "sdf sdf Application"
    }
  ],
  "timestamp": "2026-07-27T12:00:00.000Z"
}
```

---

### Get Application by Contract Number

**Endpoint:** `GET /applications/:contractNumber`

**Description:** Returns a single application by its contract number.

**Path Parameters:**

- `contractNumber` (string, required) — The contract number

**Example Request:**

```
GET /applications/1561438
```

**Success Response:**

```json
{
  "success": true,
  "message": "Request successful",
  "data": {
    "clientName": "sdf sdf",
    "product": "AMERICAN EQUITY ESTATESHIELD 10 FIXED INDEX ANNUITY",
    "anticipatedPremium": 99999,
    "startDate": "2026-07-15T13:27:11.782+00:00",
    "taxType": "Non-Qualified",
    "status": "In Progress",
    "contractNumber": "1561438",
    "productId": "I-ESTATE24",
    "agentNumber": "2026",
    "applicationLink": "https://american-equity-uatx.unqork.io/app/application#/display/application?id=6a5789ec1ce36757d331b5b8",
    "contactId": "482354",
    "applicationName": "sdf sdf Application"
  },
  "timestamp": "2026-07-27T12:00:00.000Z"
}
```

**Not Found Response (404):**

```json
{
  "success": false,
  "message": "Application with contract number 9999999 not found",
  "data": null,
  "timestamp": "2026-07-27T12:00:00.000Z"
}
```

---

## Common Response Structure

All API responses follow this consistent format:

```json
{
  "success": true | false,
  "message": "string",
  "data": object | array | null,
  "timestamp": "ISO 8601 string"
}
```

## Error Responses

| Status Code | Meaning               |
| ----------- | --------------------- |
| 200         | Success               |
| 404         | Resource not found    |
| 400         | Bad request           |
| 500         | Internal server error |

---

## Filtering Behavior

- All filters use **AND** logic (all conditions must match)
- Matching is **case-insensitive**
- Matching supports **partial match** (contains)
- Empty or undefined filter values are **ignored**
- Multiple filters can be combined: `?status=Active&taxType=Qualified`
