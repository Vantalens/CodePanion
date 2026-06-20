use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// State of a node in the reasoning graph
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NodeState {
    Unknown,
    Suspected,
    Confirmed,
    Exploited,
    Failed,
}

/// A node represents a capability, state, or finding
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    pub state: NodeState,
    pub description: String,
}

/// An edge represents a reasoning step from one node to another
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub from: String,
    pub to: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_hint: Option<String>,
    /// All these nodes must be confirmed before this edge activates
    #[serde(default)]
    pub requires_all: Vec<String>,
}

/// Reasoning graph chains findings into multi-step reasoning paths.
/// This is what separates a real agent from a simple tool-caller.
///
/// Example (Security):
///   SQLi → DB Dump → Credential Extraction → Admin Access → RCE
///
/// Example (Code Quality):
///   God Object → High Coupling → Low Testability → Regression Risk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReasoningGraph {
    pub nodes: HashMap<String, Node>,
    pub edges: Vec<Edge>,
}

impl ReasoningGraph {
    pub fn new() -> Self {
        Self {
            nodes: HashMap::new(),
            edges: Vec::new(),
        }
    }

    /// Add a node to the graph
    pub fn add_node(&mut self, id: String, description: String) {
        self.nodes.insert(
            id.clone(),
            Node {
                id,
                state: NodeState::Unknown,
                description,
            },
        );
    }

    /// Add an edge (reasoning step) to the graph
    pub fn add_edge(
        &mut self,
        from: String,
        to: String,
        description: String,
        tool_hint: Option<String>,
        requires_all: Vec<String>,
    ) {
        self.edges.push(Edge {
            from,
            to,
            description,
            tool_hint,
            requires_all,
        });
    }

    /// Update the state of a node
    pub fn mark_state(&mut self, node_id: &str, state: NodeState) {
        if let Some(node) = self.nodes.get_mut(node_id) {
            node.state = state;
        }
    }

    /// Get all edges that are currently active (ready to pursue)
    pub fn get_active_edges(&self) -> Vec<&Edge> {
        self.edges
            .iter()
            .filter(|edge| {
                // Edge activates when:
                // 1. Source node is confirmed/exploited
                // 2. All required prerequisites are confirmed/exploited

                let from_confirmed = self
                    .nodes
                    .get(&edge.from)
                    .map(|n| {
                        n.state == NodeState::Confirmed || n.state == NodeState::Exploited
                    })
                    .unwrap_or(false);

                if !from_confirmed {
                    return false;
                }

                if edge.requires_all.is_empty() {
                    return true;
                }

                edge.requires_all.iter().all(|req| {
                    self.nodes
                        .get(req)
                        .map(|n| {
                            n.state == NodeState::Confirmed || n.state == NodeState::Exploited
                        })
                        .unwrap_or(false)
                })
            })
            .collect()
    }

    /// Generate prompt context showing current graph state and available paths
    pub fn to_prompt_context(&self) -> String {
        let mut ctx = String::from("## Reasoning Graph\n\n");

        // Show confirmed nodes
        let confirmed: Vec<_> = self
            .nodes
            .values()
            .filter(|n| n.state == NodeState::Confirmed || n.state == NodeState::Exploited)
            .collect();

        if !confirmed.is_empty() {
            ctx.push_str("### Confirmed:\n");
            for node in confirmed {
                ctx.push_str(&format!("- {} ({})\n", node.description, node.id));
            }
            ctx.push('\n');
        }

        // Show available reasoning paths
        let active_edges = self.get_active_edges();
        if !active_edges.is_empty() {
            ctx.push_str("### Available Reasoning Paths:\n");
            for edge in active_edges {
                let to_desc = self
                    .nodes
                    .get(&edge.to)
                    .map(|n| n.description.as_str())
                    .unwrap_or("?");
                ctx.push_str(&format!(
                    "- {} → {} ({})\n",
                    edge.description, to_desc, edge.to
                ));
                if let Some(tool) = &edge.tool_hint {
                    ctx.push_str(&format!("  Tool: {}\n", tool));
                }
            }
        }

        ctx
    }

    /// Get all nodes in a specific state
    pub fn nodes_in_state(&self, state: NodeState) -> Vec<&Node> {
        self.nodes
            .values()
            .filter(|n| n.state == state)
            .collect()
    }

    /// Check if a node exists
    pub fn has_node(&self, node_id: &str) -> bool {
        self.nodes.contains_key(node_id)
    }
}

impl Default for ReasoningGraph {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_node() {
        let mut graph = ReasoningGraph::new();
        graph.add_node("sqli".to_string(), "SQL Injection found".to_string());

        assert!(graph.has_node("sqli"));
        let node = graph.nodes.get("sqli").unwrap();
        assert_eq!(node.state, NodeState::Unknown);
    }

    #[test]
    fn test_mark_state() {
        let mut graph = ReasoningGraph::new();
        graph.add_node("sqli".to_string(), "SQL Injection".to_string());
        graph.mark_state("sqli", NodeState::Confirmed);

        let node = graph.nodes.get("sqli").unwrap();
        assert_eq!(node.state, NodeState::Confirmed);
    }

    #[test]
    fn test_edge_activation_simple() {
        let mut graph = ReasoningGraph::new();
        graph.add_node("sqli".to_string(), "SQL Injection".to_string());
        graph.add_node("db_access".to_string(), "Database access".to_string());
        graph.add_edge(
            "sqli".to_string(),
            "db_access".to_string(),
            "Dump database".to_string(),
            Some("sqlmap".to_string()),
            vec![],
        );

        // Not active initially
        assert_eq!(graph.get_active_edges().len(), 0);

        // Activate after confirming source
        graph.mark_state("sqli", NodeState::Confirmed);
        assert_eq!(graph.get_active_edges().len(), 1);
    }

    #[test]
    fn test_edge_activation_with_prerequisites() {
        let mut graph = ReasoningGraph::new();
        graph.add_node("sqli".to_string(), "SQL Injection".to_string());
        graph.add_node("auth_bypass".to_string(), "Auth bypass".to_string());
        graph.add_node("admin_access".to_string(), "Admin access".to_string());

        // Edge requires both sqli AND auth_bypass
        graph.add_edge(
            "sqli".to_string(),
            "admin_access".to_string(),
            "Gain admin access".to_string(),
            Some("exploit".to_string()),
            vec!["auth_bypass".to_string()],
        );

        // Not active with just sqli
        graph.mark_state("sqli", NodeState::Confirmed);
        assert_eq!(graph.get_active_edges().len(), 0);

        // Activates when both are confirmed
        graph.mark_state("auth_bypass", NodeState::Confirmed);
        assert_eq!(graph.get_active_edges().len(), 1);
    }

    #[test]
    fn test_nodes_in_state() {
        let mut graph = ReasoningGraph::new();
        graph.add_node("node1".to_string(), "Node 1".to_string());
        graph.add_node("node2".to_string(), "Node 2".to_string());
        graph.add_node("node3".to_string(), "Node 3".to_string());

        graph.mark_state("node1", NodeState::Confirmed);
        graph.mark_state("node2", NodeState::Confirmed);
        graph.mark_state("node3", NodeState::Failed);

        let confirmed = graph.nodes_in_state(NodeState::Confirmed);
        assert_eq!(confirmed.len(), 2);
    }

    #[test]
    fn test_to_prompt_context() {
        let mut graph = ReasoningGraph::new();
        graph.add_node("sqli".to_string(), "SQL Injection found".to_string());
        graph.add_node("db_access".to_string(), "Database access".to_string());
        graph.add_edge(
            "sqli".to_string(),
            "db_access".to_string(),
            "Dump database".to_string(),
            Some("sqlmap".to_string()),
            vec![],
        );

        graph.mark_state("sqli", NodeState::Confirmed);

        let context = graph.to_prompt_context();
        assert!(context.contains("Confirmed:"));
        assert!(context.contains("SQL Injection"));
        assert!(context.contains("Available Reasoning Paths:"));
        assert!(context.contains("sqlmap"));
    }

    #[test]
    fn test_exploited_state_activates_edges() {
        let mut graph = ReasoningGraph::new();
        graph.add_node("sqli".to_string(), "SQL Injection".to_string());
        graph.add_node("db_access".to_string(), "Database access".to_string());
        graph.add_edge(
            "sqli".to_string(),
            "db_access".to_string(),
            "Dump database".to_string(),
            None,
            vec![],
        );

        // Exploited state should also activate downstream edges
        graph.mark_state("sqli", NodeState::Exploited);
        assert_eq!(graph.get_active_edges().len(), 1);
    }
}
