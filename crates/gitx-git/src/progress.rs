//! Parses git `--progress` stderr lines (CR-refreshed).

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProgressSnapshot {
    pub phase: Option<String>,
    pub percent: Option<f32>,
    pub current: Option<u64>,
    pub total: Option<u64>,
    pub message: Option<String>,
}

pub struct ProgressParser;

impl ProgressParser {
    pub fn parse_line(line: &str) -> Option<ProgressSnapshot> {
        let line = line.trim().trim_end_matches('\r');
        if line.is_empty() {
            return None;
        }
        // Example: "Receiving objects:  45% (450/1000), 1.2 MiB | 2 MiB/s"
        let re = regex::Regex::new(
            r"(?P<phase>[A-Za-z ]+):\s+(?P<pct>\d+)%\s+\((?P<cur>\d+)/(?P<total>\d+)\)",
        )
        .ok()?;
        let caps = re.captures(line)?;
        Some(ProgressSnapshot {
            phase: Some(caps.name("phase")?.as_str().trim().to_string()),
            percent: caps.name("pct")?.as_str().parse().ok(),
            current: caps.name("cur")?.as_str().parse().ok(),
            total: caps.name("total")?.as_str().parse().ok(),
            message: Some(line.to_string()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_receiving_objects() {
        let snap = ProgressParser::parse_line("Receiving objects:  45% (450/1000), 1.2 MiB")
            .expect("parse");
        assert_eq!(snap.phase.as_deref(), Some("Receiving objects"));
        assert_eq!(snap.percent, Some(45.0));
        assert_eq!(snap.current, Some(450));
        assert_eq!(snap.total, Some(1000));
    }
}
