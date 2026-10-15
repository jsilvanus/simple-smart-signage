# D-038 — Tenant API connectors and scene variable bindings

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision:** SiSSi uses tenant-level API connectors with securely stored credentials, configured requests, response mappings, and named variables. Reuse the existing `varfetch` core and the connector model implemented in `jsilvanus/live-captions-yt`, adapting persistence, permissions, and scope to SiSSi's tenant model.
- **Variable syntax:** `{{var}}` is the standard variable interpolation syntax. Namespaced connector variables use `{{connector.variable}}`. The additional `[alias]` form is also supported; its exact resolution semantics should be specified as part of the variable-reference contract rather than assumed to be identical to interpolation.
- **Fetch timing:** A variable reference does not itself trigger a request. Each use declares whether its value is resolved at creation time, build time, or runtime. Runtime fetching is invoked through the trusted host/API-connection mechanism, not by exposing credentials to scene code.
- **Authoring integration:** Variable references are recognized while creating and editing scenes, including structured template inputs. The authoring UI lets the creator select configured connectors/variables and choose timing. Variable discovery/configuration is distinct from fetching the value.
- **Security boundary:** Connector secrets and privileged outbound requests remain server-side. Connector access is tenant-governed and must be explicitly authorised for the relevant creator, scene, and runtime use. Apply varfetch's outbound-request security protections and server-owned network policy.
- **Rationale:** Reuses an existing, tested connector/interpolation architecture while making API-backed data available consistently to AI-authored scenes, human-edited code, and structured content fields.
- **References:** [LCYT connector/variable design](https://github.com/jsilvanus/live-captions-yt/blob/main/docs/plans/plan_api_connectors_variables.md) · [varfetch](https://github.com/jsilvanus/varfetch) · [Content creation and authoring](../creation-system.md)

## Implementation notes

- Connector configuration is tenant-level; sharing a connector with a scene or authoring workflow does not expose its authentication configuration.
- A configured connector may contain multiple named requests. Requests map response fields to variables.
- Variable interpolation reads the applicable resolved value; it does not implicitly refresh dependencies or create cascading requests.
- Creation-time values become authored content when accepted; build-time values are resolved for the published build; runtime values are resolved through an explicit runtime policy/action. Exact caching, failure, default-value, and refresh semantics remain to be specified.
- The scene source remains fully editable. AI and human coders should expose useful structured input points (such as headings, dates, liturgical colours, and animation colours) without restricting access to the underlying HTML/CSS/JavaScript.
