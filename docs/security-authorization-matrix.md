# Portal and direct-API authorization matrix

Navigation is advisory only. Every protected request is authenticated, resolved to the school from the request hostname, matched to an active membership for that school, and checked again against the endpoint permission. Database access additionally supplies the resolved `school_id`; resource-level services constrain teachers to assignments, guardians to linked children, and students/applicants to self.

| Experience | Roles | Resource scope | Principal capabilities |
| --- | --- | --- | --- |
| Administrator | `super_admin`, `school_admin` | School-wide | People, academics, attendance, results, finance, admissions, learning, configuration, membership and audit |
| Teacher | `teacher` | Assigned resources | Assigned students/classes, attendance capture, results entry, exams, lessons, assignments and classroom messages |
| Student | `student` | Self | Own results, fees, lessons, assignments, library and messages |
| Parent | `parent` | Linked children | Linked-child results/fees, parent summaries and messages; no classroom membership |
| Applicant | `applicant` | Self/application | Own application, entrance examination, applicant finance and messages |
| Finance | `bursar` | School-wide specialist | Student/academic lookup, fees and payment verification |
| Admissions | `admissions_officer` | School-wide specialist | Admissions, applicant people context and messages |
| Examinations | `exam_officer` | School-wide specialist | Academic lookup, formal results and examinations |
| Registrar | `registrar` | School-wide specialist | Student records, academics, attendance correction, result lookup and membership lookup |
| Library | `librarian` | School-wide specialist | Student/academic lookup, library administration and messages |
| Platform | `moderator` | Platform only | Platform schools, domains, entitlements, operators, settings and platform audit; school data requires an audited support session |

The executable matrix is `tests/security/authorization-matrix.test.ts`. It sends direct HTTP requests through the production permission middleware for every role × permission pair and separately proves that a user belonging only to School B is rejected on School A's hostname. Changes to `permissions`, `permissionsByRole`, membership resolution or permission middleware therefore remain covered without relying on hidden navigation.
