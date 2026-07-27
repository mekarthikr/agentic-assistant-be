# Mock API Server — RAG API Documentation

## Service overview

The Mock API Server is a read-only REST API for retrieving annuity contracts
and annuity applications.

- Base URL: `https://mock-api-server-zeta.vercel.app`
- API base path: `/api/v1`
- Full API base URL: `https://mock-api-server-zeta.vercel.app/api/v1`
- Authentication: None
- Request format: JSON
- Response format: JSON
- Supported operations: `GET` only

Build every API request using the base URL plus the API base path. For example,
`GET /api/v1/contracts` resolves to
`https://mock-api-server-zeta.vercel.app/api/v1/contracts`.

## API selection rules for AI agents

Use the contracts API when the user asks about an issued contract or policy,
including:

- Current contract or policy value
- Issue date
- Anniversary date
- Contract status such as Active, Inactive, or Surrendered
- Tax qualification such as IRA or ROTH IRA
- Distribution company
- Issued contract product

Use the applications API when the user asks about an application or its
workflow, including:

- Anticipated premium
- Application start date
- Application status such as In Progress, Submitted, Approved, or Rejected
- Product ID
- Agent number
- Contact ID
- Application name
- Application link

Both resources contain a field named `contractNumber`, but contracts and
applications are separate collections.

Use a detail endpoint when one exact contract number is supplied and the user
wants one record.

Use a list endpoint when:

- No exact contract number is supplied.
- The user wants multiple records.
- The user wants to find records by client, product, status, agent, tax type,
  or another supported filter.

Do not call an API when the user asks to create, update, submit, approve,
reject, or delete data. This backend does not support mutations.

## Natural-language field mapping

| User language                                                                   | API field            | Resource                    |
| ------------------------------------------------------------------------------- | -------------------- | --------------------------- |
| Contract number, contract ID, policy number, policy ID                          | `contractNumber`     | Contracts or applications   |
| Customer, owner, client, insured, applicant                                     | `clientName`         | Contracts or applications   |
| Issued product, contract product, policy product                                | `productName`        | Contracts                   |
| Application product, applied product                                            | `product`            | Applications                |
| Contract status, policy status, active, inactive, surrendered                   | `contractStatus`     | Contracts                   |
| Application status, workflow status, in progress, submitted, approved, rejected | `status`             | Applications                |
| Tax type, tax category                                                          | `taxType`            | Contracts or applications   |
| IRA, Roth IRA, non-qualified detail                                             | `taxQualification`   | Contracts                   |
| Producer, advisor, writing agent, agent ID                                      | `agentNumber`        | Applications                |
| Contact, contact ID                                                             | `contactId`          | Applications                |
| Current value, policy value, account value                                      | `currentValue`       | Contracts; response-only    |
| Anticipated premium, expected premium, planned premium                          | `anticipatedPremium` | Applications; response-only |

Important distinctions:

- `currentValue` belongs to contracts.
- `anticipatedPremium` belongs to applications.
- Contract product filters use `productName`.
- Application product filters use `product`.
- Contract state filters use `contractStatus`.
- Application workflow state filters use `status`.

## Common response format

Every response uses this envelope:

```json
{
  "success": true,
  "message": "Request successful",
  "data": {},
  "timestamp": "2026-07-28T10:00:00.000Z"
}
```

Fields:

- `success`: Boolean indicating success or failure.
- `message`: Human-readable result message.
- `data`: An object, an array, or `null`.
- `timestamp`: ISO-8601 server response time.

An error response has `success: false` and `data: null`.

## List filtering rules

The contracts and applications list endpoints support query-string filters.

- Filter matching is case-insensitive.
- A filter matches an exact value or a substring.
- Multiple filters use AND logic. Every supplied filter must match the same
  record.
- Empty query values are ignored.
- Unknown query parameter names are silently ignored.
- No matches return HTTP `200` with `data: []`.
- Pagination is not supported.
- Sorting is not supported.
- Free-form search is not supported.
- Numeric ranges are not supported.
- Date ranges and before/after comparisons are not supported.
- Date filters perform string matching only.

Do not invent filter names. Because unknown parameters are ignored, an
invented parameter can accidentally return all records.

---

## Endpoint: Check service health

### Intent

Use this endpoint to determine whether the API is reachable and healthy.

Do not use it to retrieve contracts or applications.

### Request

```http
GET /api/v1/health
```

No path parameters, query parameters, request body, or authentication are
required.

### Successful response

HTTP status: `200 OK`

```json
{
  "success": true,
  "message": "Service is healthy",
  "data": {
    "status": "ok"
  },
  "timestamp": "2026-07-28T10:00:00.000Z"
}
```

### Example user requests

- Is the backend running?
- Check API health.
- Is the service available?

---

## Endpoint: List and filter contracts

### Intent

Use this endpoint to retrieve zero or more issued annuity contracts.

Use it for contract and policy facts such as current value, issue date,
anniversary date, contract status, tax qualification, and distribution
company.

Do not use it for application workflow status, anticipated premium, agent
number, contact ID, or application links.

### Request

```http
GET /api/v1/contracts
```

### Supported query parameters

| Parameter             | Type   | Required | Meaning                     |
| --------------------- | ------ | -------- | --------------------------- |
| `contractNumber`      | string | No       | Contract identifier         |
| `clientName`          | string | No       | Contract owner's name       |
| `productName`         | string | No       | Issued annuity product name |
| `contractStatus`      | string | No       | Contract state              |
| `taxType`             | string | No       | General tax category        |
| `taxQualification`    | string | No       | Detailed tax qualification  |
| `distributionCompany` | string | No       | Distribution company        |

Known values in the current mock data:

- `contractStatus`: `Active`, `Inactive`, `Surrendered`
- `taxType`: `Qualified`, `Non-Qualified`
- `taxQualification`: `IRA`, `ROTH IRA`, `NON-QUAL`
- `distributionCompany`: `AELife`

The following response fields cannot be used as filters:

- `issuedDate`
- `currentValue`
- `anniversaryDate`

### Request examples

List all contracts:

```http
GET /api/v1/contracts
```

Find active qualified contracts:

```http
GET /api/v1/contracts?contractStatus=Active&taxType=Qualified
```

Find contracts for clients whose name contains `Brown`:

```http
GET /api/v1/contracts?clientName=Brown
```

Find AssetShield 5 contracts:

```http
GET /api/v1/contracts?productName=AssetShield%205
```

### Response data schema

Each object in `data` contains:

| Field                 | Type   | Meaning                            |
| --------------------- | ------ | ---------------------------------- |
| `contractNumber`      | string | Issued contract identifier         |
| `clientName`          | string | Contract owner's name              |
| `productName`         | string | Annuity product name               |
| `issuedDate`          | string | ISO-8601 issue date and time       |
| `currentValue`        | number | Current monetary contract value    |
| `anniversaryDate`     | string | ISO-8601 anniversary date and time |
| `taxType`             | string | General tax category               |
| `contractStatus`      | string | Current issued-contract state      |
| `taxQualification`    | string | Detailed tax qualification         |
| `distributionCompany` | string | Distribution company               |

### Successful response example

HTTP status: `200 OK`

```json
{
  "success": true,
  "message": "Request successful",
  "data": [
    {
      "contractNumber": "1561092",
      "clientName": "SMITH JOHN",
      "productName": "AMERICAN EQUITY ASSETSHIELD 10 FIXED INDEX ANNUITY",
      "issuedDate": "2025-03-10T05:00:00+00:00",
      "currentValue": 125000,
      "anniversaryDate": "2026-03-10T05:00:00+00:00",
      "taxType": "Non-Qualified",
      "contractStatus": "Active",
      "taxQualification": "NON-QUAL",
      "distributionCompany": "AELife"
    }
  ],
  "timestamp": "2026-07-28T10:00:00.000Z"
}
```

### AI call examples

User: Find active qualified contracts.

```http
GET /api/v1/contracts?contractStatus=Active&taxType=Qualified
```

User: Show issued contracts for Smith.

```http
GET /api/v1/contracts?clientName=Smith
```

User: Find contracts worth more than 100000.

No exact API call can satisfy this request because `currentValue` is not
filterable and numeric range filtering is unsupported. The caller may retrieve
all contracts and filter the returned data outside this API if permitted.

---

## Endpoint: Get one contract by contract number

### Intent

Use this endpoint when one exact issued contract number is known and the user
wants issued-contract details.

### Request

```http
GET /api/v1/contracts/{contractNumber}
```

### Path parameter

| Parameter        | Type   | Required | Meaning                          |
| ---------------- | ------ | -------- | -------------------------------- |
| `contractNumber` | string | Yes      | Exact issued contract identifier |

The lookup is exact.

### Request example

```http
GET /api/v1/contracts/1561092
```

### Successful response

HTTP status: `200 OK`

```json
{
  "success": true,
  "message": "Request successful",
  "data": {
    "contractNumber": "1561092",
    "clientName": "SMITH JOHN",
    "productName": "AMERICAN EQUITY ASSETSHIELD 10 FIXED INDEX ANNUITY",
    "issuedDate": "2025-03-10T05:00:00+00:00",
    "currentValue": 125000,
    "anniversaryDate": "2026-03-10T05:00:00+00:00",
    "taxType": "Non-Qualified",
    "contractStatus": "Active",
    "taxQualification": "NON-QUAL",
    "distributionCompany": "AELife"
  },
  "timestamp": "2026-07-28T10:00:00.000Z"
}
```

### Not-found response

HTTP status: `404 Not Found`

```json
{
  "success": false,
  "message": "Contract 9999999 not found",
  "data": null,
  "timestamp": "2026-07-28T10:00:00.000Z"
}
```

### AI call examples

User: What is the current value of contract 1561092?

```http
GET /api/v1/contracts/1561092
```

User: What is the application status of contract 1561439?

Use the application detail endpoint instead:

```http
GET /api/v1/applications/1561439
```

---

## Endpoint: List and filter applications

### Intent

Use this endpoint to retrieve zero or more annuity application workflow
records.

Use it for application facts such as anticipated premium, start date,
application status, product ID, agent number, contact ID, application name,
and application link.

Do not use it for issued-contract current value, issue date, anniversary date,
contract status, tax qualification, or distribution company.

### Request

```http
GET /api/v1/applications
```

### Supported query parameters

| Parameter         | Type   | Required | Meaning                         |
| ----------------- | ------ | -------- | ------------------------------- |
| `clientName`      | string | No       | Applicant name                  |
| `product`         | string | No       | Application product name        |
| `taxType`         | string | No       | General tax category            |
| `status`          | string | No       | Application workflow status     |
| `contractNumber`  | string | No       | Application contract identifier |
| `productId`       | string | No       | Product identifier              |
| `agentNumber`     | string | No       | Writing agent identifier        |
| `contactId`       | string | No       | Applicant contact identifier    |
| `applicationName` | string | No       | Application display name        |
| `startDate`       | string | No       | ISO-8601 start date-time text   |

Known values in the current mock data:

- `status`: `In Progress`, `Submitted`, `Approved`, `Rejected`
- `taxType`: `Qualified`, `Non-Qualified`

Important parameter names:

- Use `product`, not `productName`.
- Use `status`, not `contractStatus`.

The following response fields cannot be used as filters:

- `anticipatedPremium`
- `applicationLink`

`startDate` uses substring matching. For example, `startDate=2026-07` finds
records whose serialized start date contains `2026-07`. It does not perform a
date-range comparison.

### Request examples

List all applications:

```http
GET /api/v1/applications
```

Find applications in progress for agent 2026:

```http
GET /api/v1/applications?status=In%20Progress&agentNumber=2026
```

Find applications started in July 2026:

```http
GET /api/v1/applications?startDate=2026-07
```

Find qualified AssetShield 5 applications:

```http
GET /api/v1/applications?product=AssetShield%205&taxType=Qualified
```

### Response data schema

Each object in `data` contains:

| Field                | Type   | Meaning                                  |
| -------------------- | ------ | ---------------------------------------- |
| `clientName`         | string | Applicant name                           |
| `product`            | string | Annuity product name                     |
| `anticipatedPremium` | number | Expected premium amount                  |
| `startDate`          | string | ISO-8601 application start date and time |
| `taxType`            | string | General tax category                     |
| `status`             | string | Application workflow status              |
| `contractNumber`     | string | Application contract identifier          |
| `productId`          | string | Product identifier                       |
| `agentNumber`        | string | Agent identifier                         |
| `applicationLink`    | string | URL that opens the application           |
| `contactId`          | string | Contact identifier                       |
| `applicationName`    | string | Application display name                 |

### Successful response example

HTTP status: `200 OK`

```json
{
  "success": true,
  "message": "Request successful",
  "data": [
    {
      "clientName": "JOHNSON MARY",
      "product": "AMERICAN EQUITY ASSETSHIELD 5 FIXED INDEX ANNUITY",
      "anticipatedPremium": 150000,
      "startDate": "2026-07-10T09:15:00.000+00:00",
      "taxType": "Qualified",
      "status": "Submitted",
      "contractNumber": "1561439",
      "productId": "I-ASSET5-24",
      "agentNumber": "2030",
      "applicationLink": "https://american-equity-uatx.unqork.io/app/application#/display/application?id=7b6890fd2df47868e442c6c9",
      "contactId": "482355",
      "applicationName": "JOHNSON MARY Application"
    }
  ],
  "timestamp": "2026-07-28T10:00:00.000Z"
}
```

### AI call examples

User: Show applications that are in progress for agent 2026.

```http
GET /api/v1/applications?status=In%20Progress&agentNumber=2026
```

User: Find approved applications for non-qualified money.

```http
GET /api/v1/applications?status=Approved&taxType=Non-Qualified
```

User: Find applications with anticipated premium above 200000.

No exact API call can satisfy this request because `anticipatedPremium` is not
filterable and numeric range filtering is unsupported. The caller may retrieve
all applications and filter the returned data outside this API if permitted.

---

## Endpoint: Get one application by contract number

### Intent

Use this endpoint when one exact application contract number is known and the
user wants application details.

### Request

```http
GET /api/v1/applications/{contractNumber}
```

### Path parameter

| Parameter        | Type   | Required | Meaning                               |
| ---------------- | ------ | -------- | ------------------------------------- |
| `contractNumber` | string | Yes      | Exact application contract identifier |

The lookup is exact.

### Request example

```http
GET /api/v1/applications/1561439
```

### Successful response

HTTP status: `200 OK`

```json
{
  "success": true,
  "message": "Request successful",
  "data": {
    "clientName": "JOHNSON MARY",
    "product": "AMERICAN EQUITY ASSETSHIELD 5 FIXED INDEX ANNUITY",
    "anticipatedPremium": 150000,
    "startDate": "2026-07-10T09:15:00.000+00:00",
    "taxType": "Qualified",
    "status": "Submitted",
    "contractNumber": "1561439",
    "productId": "I-ASSET5-24",
    "agentNumber": "2030",
    "applicationLink": "https://american-equity-uatx.unqork.io/app/application#/display/application?id=7b6890fd2df47868e442c6c9",
    "contactId": "482355",
    "applicationName": "JOHNSON MARY Application"
  },
  "timestamp": "2026-07-28T10:00:00.000Z"
}
```

### Not-found response

HTTP status: `404 Not Found`

```json
{
  "success": false,
  "message": "Application with contract number 9999999 not found",
  "data": null,
  "timestamp": "2026-07-28T10:00:00.000Z"
}
```

### AI call examples

User: What is the status and anticipated premium for application 1561439?

```http
GET /api/v1/applications/1561439
```

User: What is the current contract value for 1561092?

Use the issued contract detail endpoint instead:

```http
GET /api/v1/contracts/1561092
```

---

## Error behavior

### Resource not found

Contract detail endpoints return:

```json
{
  "success": false,
  "message": "Contract 9999999 not found",
  "data": null,
  "timestamp": "2026-07-28T10:00:00.000Z"
}
```

Application detail endpoints return:

```json
{
  "success": false,
  "message": "Application with contract number 9999999 not found",
  "data": null,
  "timestamp": "2026-07-28T10:00:00.000Z"
}
```

### Unknown route

HTTP status: `404 Not Found`

```json
{
  "success": false,
  "message": "Route not found",
  "data": null,
  "timestamp": "2026-07-28T10:00:00.000Z"
}
```

### Empty list

An empty list is not an error:

```json
{
  "success": true,
  "message": "Request successful",
  "data": [],
  "timestamp": "2026-07-28T10:00:00.000Z"
}
```

## Recommended RAG chunk boundaries

For retrieval, split this document at each second-level heading beginning with
`Endpoint:`. Keep these sections with every endpoint chunk:

- Service overview
- API selection rules for AI agents
- Common response format
- List filtering rules

Each endpoint chunk should retain:

- Intent
- Request method and path
- Supported parameters
- Response schema
- Examples
- Resource-specific warnings

The selection rules are important because contracts and applications share a
`contractNumber` field but answer different business questions.
