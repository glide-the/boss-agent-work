// reconstructed module: peer_authorization
// evidence:
// - symbols: PeerAuthorizer::authorize_unix_stream, code_identity_for_peer_at_depth, extension_host_copy_code_identity_for_audit_token_at_depth
// - dependencies/strings: Security.framework, libbsm, audit_token_to_pid, SecCode, SecCodeInfoIdentifier, SecCodeInfoTeamIdentifier, trustedBrowserClientSha256s
// confidence: medium-high

use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeIdentity {
    pub pid: Option<u32>,
    pub bundle_identifier: Option<String>,
    pub team_identifier: Option<String>,
    pub executable_sha256: Option<String>,
}

pub struct PeerAuthorizer {
    trusted_hashes: HashSet<String>,
    trusted_bundle_ids: HashSet<String>,
    trusted_team_ids: HashSet<String>,
}

impl PeerAuthorizer {
    pub fn new(trusted_hashes: impl IntoIterator<Item = String>) -> Self {
        Self {
            trusted_hashes: trusted_hashes.into_iter().collect(),
            trusted_bundle_ids: ["com.openai.codex".to_string(), "com.google.Chrome".to_string()].into_iter().collect(),
            trusted_team_ids: HashSet::new(),
        }
    }

    pub fn authorize_identity(&self, identity: &CodeIdentity) -> Result<(), AuthorizationError> {
        if let Some(hash) = &identity.executable_sha256 { if self.trusted_hashes.contains(hash) { return Ok(()); } }
        if let Some(bundle_id) = &identity.bundle_identifier { if self.trusted_bundle_ids.contains(bundle_id) { return Ok(()); } }
        if let Some(team_id) = &identity.team_identifier { if self.trusted_team_ids.contains(team_id) { return Ok(()); } }
        Err(AuthorizationError::Untrusted(identity.clone()))
    }

    pub fn authorize_unix_stream_placeholder(&self) -> Result<(), AuthorizationError> {
        // Real binary appears to obtain audit token / PID from the accepted Unix stream,
        // then asks macOS Security.framework for SecCode signing information.
        // This placeholder keeps the verification boundary explicit.
        Err(AuthorizationError::NeedsMacosSecCode)
    }
}

#[derive(Debug)]
pub enum AuthorizationError { NeedsMacosSecCode, Untrusted(CodeIdentity) }
impl std::fmt::Display for AuthorizationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self { Self::NeedsMacosSecCode => write!(f, "macOS SecCode audit-token authorization is required"), Self::Untrusted(identity) => write!(f, "untrusted peer identity: {identity:?}") }
    }
}
impl std::error::Error for AuthorizationError {}
