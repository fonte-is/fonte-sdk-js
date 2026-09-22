#[cfg(target_os = "macos")]
mod darwin;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
pub use darwin::{read, replace};
#[cfg(target_os = "linux")]
pub use linux::{read, replace};
#[cfg(target_os = "windows")]
pub use windows::{read, replace};

#[derive(Debug)]
pub enum StoreError {
    InteractionRequired,
    Invalid,
    Unavailable,
}

impl StoreError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InteractionRequired => "fonte_store_interaction_required",
            Self::Invalid => "fonte_store_invalid",
            Self::Unavailable => "fonte_store_unavailable",
        }
    }
}
