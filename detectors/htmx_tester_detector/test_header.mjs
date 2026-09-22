// The htmx tester family shares the tester-persona header parser rather than
// carrying a second copy: `coder.bun.duplication-intra-layer` refuses duplicated
// logic, and a detector suite that breaks its own rules has no standing.
export * from "../bun_tester_discipline_detector/test_header.mjs";
