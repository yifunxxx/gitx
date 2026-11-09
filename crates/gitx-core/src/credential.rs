use serde::{Deserialize, Serialize};

/// A session credential is valid only for its explicit HTTP origin.
#[derive(Clone, Serialize, Deserialize)]
pub struct CredentialSession {
    pub origin: String,
    pub username: String,
    pub password: String,
}

impl CredentialSession {
    pub fn origin_for(target: &str) -> Option<String> {
        let url = url::Url::parse(target).ok()?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
            return None;
        }
        Some(url.origin().ascii_serialization())
    }

    pub fn answer(&self, prompt: &str) -> Option<&str> {
        let start = prompt.find("https://").or_else(|| prompt.find("http://"))?;
        let target = prompt[start..].split(['\'', '"', ' ']).next()?;
        if Self::origin_for(target).as_deref() != Some(self.origin.as_str()) {
            return None;
        }
        let lower = prompt.to_ascii_lowercase();
        if lower.starts_with("username") {
            Some(&self.username)
        } else if lower.starts_with("password") {
            let url = url::Url::parse(target).ok()?;
            // Git can include an email username in a prompt, percent encoded or literal.
            let username = url.username();
            if !username.is_empty() {
                let expected = url::Url::parse(&format!("{}/", self.origin)).ok()?;
                let mut expected = expected;
                expected.set_username(&self.username).ok()?;
                if username != expected.username() {
                    return None;
                }
            }
            Some(&self.password)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_are_scoped_to_origin_and_account() {
        let session = CredentialSession {
            origin: "https://example.test:8443".into(),
            username: "test".into(),
            password: "secret".into(),
        };
        assert_eq!(
            session.answer("Username for 'https://example.test:8443': "),
            Some("test")
        );
        assert_eq!(
            session.answer("Password for 'https://test@example.test:8443': "),
            Some("secret")
        );
        assert!(session
            .answer("Password for 'https://other@example.test:8443': ")
            .is_none());
        assert!(session
            .answer("Password for 'https://other.test:8443': ")
            .is_none());
        assert!(session
            .answer("Password for 'https://example.test': ")
            .is_none());
        assert!(session
            .answer("Enter passphrase for key '/tmp/key': ")
            .is_none());
    }
}
