<research_objective>
Comprehensively audit and update the Elite Next.js Clerk Convex starter template to the latest stable versions of all dependencies, identify and remediate security vulnerabilities, and modernize code patterns to align with current best practices.

This research will produce a complete migration plan including updated package.json, security audit results, breaking changes documentation, and specific code pattern updates needed across the template.
</research_objective>

<context>
This is a production starter template using:
- Next.js 15.3.5 (needs update to Next.js 16)
- React 19.0.0
- Clerk for authentication (@clerk/nextjs ^6.24.0, @clerk/backend ^2.4.1)
- Convex for backend (^1.25.2)
- Radix UI components
- Tailwind CSS v4
- TypeScript 5

The template must remain production-ready after updates, with all breaking changes properly migrated.

Current package.json located at: @package.json
</context>

<scope>
Your research must cover:

1. **Dependency Version Audit**
   - Check ALL dependencies in package.json for latest stable versions
   - Identify major, minor, and patch updates available
   - Flag any deprecated packages or packages with known issues

2. **Security Vulnerability Scan**
   - Run npm audit or equivalent to identify security issues
   - Check for CVEs in current dependency versions
   - Prioritize critical and high-severity vulnerabilities
   - Document all security findings with severity levels

3. **Breaking Changes Analysis**
   - Next.js 15 → Next.js 16 breaking changes
   - React 19 updates and new patterns
   - Clerk SDK updates
   - Convex client library updates
   - Radix UI component API changes
   - Tailwind CSS v4 changes
   - Any other packages with breaking changes

4. **Code Pattern Modernization**
   Thoroughly analyze current codebase patterns and identify updates needed for:
   - Next.js App Router patterns (Server Components, streaming, caching strategies)
   - React 19 patterns (Server Components, Actions, new hooks, concurrent features)
   - Clerk authentication integration patterns
   - Convex query/mutation patterns
   - TypeScript usage and typing patterns

5. **Node.js Compatibility**
   - Verify all packages work with Node.js 24.12.0
   - Check for any engine requirements that need updating
     </scope>

<research_process>
Follow this systematic approach:

**Phase 1: Current State Assessment**

1. Read @package.json completely to understand all current dependencies
2. Use the codebase-retrieval MCP tool to understand the project structure and identify all key code patterns being used
3. Document the current tech stack baseline

**Phase 2: Latest Versions Research**

1. Research latest stable versions for each dependency using web search
2. Pay special attention to:
   - Next.js 16 (current version, release notes, migration guide)
   - Clerk latest stable versions
   - Convex latest stable versions
   - Radix UI component updates
3. Create a dependency update matrix showing: package name, current version, latest version, update type (major/minor/patch)

**Phase 3: Security Audit**

1. Run: `npm audit --json` to get security vulnerability report
2. Research any flagged vulnerabilities
3. Check npm advisories for all current packages
4. Document all security findings with remediation steps

**Phase 4: Breaking Changes Documentation**
For each package with major version updates:

1. Find official migration guides and changelogs
2. Document breaking changes that affect this template
3. Identify specific code locations that need updates
4. Note any new features that should be adopted

**Phase 5: Code Pattern Analysis**
Use codebase-retrieval to examine:

1. App Router usage patterns in app/ directory
2. Server Component and Client Component patterns
3. Clerk authentication implementation
4. Convex queries and mutations
5. Component library usage patterns

Compare against latest best practices and document modernization opportunities.

**Phase 6: Migration Plan Creation**
Synthesize all findings into actionable migration plan with:

1. Updated package.json with all new versions
2. Prioritized list of code changes needed
3. Step-by-step migration instructions
4. Testing strategy to verify nothing breaks
   </research_process>

<deliverables>
Create a comprehensive report saved to: `./research/template-update-plan.md`

The report must include:

## 1. Executive Summary

- High-level overview of updates needed
- Security status and critical issues
- Estimated effort for full migration

## 2. Dependency Update Matrix

Table format:
| Package | Current | Latest | Type | Breaking Changes | Security Issues |
|---------|---------|--------|------|------------------|-----------------|

## 3. Security Audit Results

- Full vulnerability report
- Severity levels (critical/high/medium/low)
- Remediation steps for each issue
- Packages that need immediate attention

## 4. Breaking Changes Detail

For each major update:

- What changed
- Why it matters for this template
- Specific files/patterns affected
- Migration steps required

## 5. Code Pattern Updates

- Current patterns vs. modern best practices
- Specific code locations needing updates
- Example before/after code snippets
- Rationale for each modernization

## 6. Updated package.json

Complete, ready-to-use package.json with:

- All dependencies updated to latest stable
- Security issues resolved
- Peer dependency compatibility verified

## 7. Migration Checklist

Step-by-step instructions:

- [ ] Pre-migration steps (backups, branch creation)
- [ ] Dependency updates in order
- [ ] Code pattern migrations
- [ ] Testing strategy
- [ ] Verification steps

## 8. Risk Assessment

- Potential issues during migration
- Rollback strategy
- Testing recommendations

Save this comprehensive report to: `./research/template-update-plan.md`
</deliverables>

<tools_and_commands>
Use these tools effectively:

1. **Read tool**: Read @package.json and any configuration files
2. **Codebase-retrieval MCP**: Understand code patterns and structure
3. **Bash commands**:
   - `npm audit --json` for security scan
   - `npm outdated --json` for version info (if helpful)
4. **Web search**: Research latest versions, migration guides, security advisories
5. **Exa code context**: Get latest documentation for Next.js 16, React 19, Clerk, Convex

For maximum efficiency, invoke multiple tools in parallel when gathering independent information.
</tools_and_commands>

<evaluation_criteria>
Your research is complete when:

- ✅ All dependencies have been checked for updates
- ✅ Security audit has been run and analyzed
- ✅ All breaking changes have been documented with migration steps
- ✅ Code patterns have been reviewed against current best practices
- ✅ Updated package.json is ready to use
- ✅ Migration checklist is clear and actionable
- ✅ Report is comprehensive, well-organized, and production-ready
  </evaluation_criteria>

<verification>
Before completing, verify:
- All major dependencies (Next.js, React, Clerk, Convex, Radix UI) are researched
- Security vulnerabilities are documented with severity and remediation
- Breaking changes include specific file locations and code examples
- Migration plan is step-by-step and could be followed by another developer
- Updated package.json has been tested for peer dependency conflicts
- Report is saved to ./research/template-update-plan.md
</verification>

<success_criteria>

- Comprehensive audit of all 40+ dependencies in package.json
- Security vulnerabilities identified and prioritized
- Next.js 16 migration path clearly documented
- All breaking changes mapped to specific code locations
- Modernization opportunities identified for current code patterns
- Ready-to-use updated package.json provided
- Clear, actionable migration checklist created
- Report is thorough enough to execute the full migration confidently
  </success_criteria>
