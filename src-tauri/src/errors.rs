//! Errors the UI shows travel as stable codes it translates (`src/lib/errors.ts`):
//! `err:<code>`, or `err:<code>:<detail>` when a raw detail (an OS or network error, a
//! status) helps. Internal and log-only errors keep their plain text.

/// `err:<code>`.
pub fn code(code: &str) -> String {
    format!("err:{code}")
}

/// `err:<code>:<detail>`.
pub fn detail(code: &str, detail: impl std::fmt::Display) -> String {
    format!("err:{code}:{detail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_have_a_stable_shape() {
        assert_eq!(code("invalidItem"), "err:invalidItem");
        assert_eq!(detail("serverStatus", 502), "err:serverStatus:502");
        assert_eq!(detail("network", "a: b"), "err:network:a: b");
    }
}
