use super::StoreError;
use secret_service::{EncryptionType, Error as SecretError, SecretService};
use std::collections::HashMap;
use zbus::fdo::DBusProxy;
use zbus::names::{BusName, OwnedUniqueName};

const SERVICE_NAME: &str = "org.freedesktop.secrets";
const LABEL: &str = "Fonte customer session";

extern "C" {
    fn geteuid() -> u32;
}

pub fn read() -> Result<Option<Vec<u8>>, StoreError> {
    zbus::block_on(async {
        let connection = zbus::Connection::session()
            .await
            .map_err(|_| StoreError::Unavailable)?;
        let owner = existing_owner(&connection).await?;
        let service = SecretService::connect_with_existing(EncryptionType::Dh, connection.clone())
            .await
            .map_err(map_secret)?;
        let result = service
            .search_items(attributes())
            .await
            .map_err(map_secret)?;
        if result.unlocked.len() + result.locked.len() > 1 {
            return Err(StoreError::Invalid);
        }
        if !result.locked.is_empty() {
            return Err(StoreError::InteractionRequired);
        }
        let payload = match result.unlocked.first() {
            Some(item) => Some(item.get_secret().await.map_err(map_secret)?),
            None => None,
        };
        require_same_owner(&connection, &owner).await?;
        Ok(payload)
    })
}

pub fn replace(payload: &[u8], permit_interaction: bool) -> Result<(), StoreError> {
    zbus::block_on(async {
        let connection = zbus::Connection::session()
            .await
            .map_err(|_| StoreError::Unavailable)?;
        let owner = existing_owner(&connection).await?;
        let service = SecretService::connect_with_existing(EncryptionType::Dh, connection.clone())
            .await
            .map_err(map_secret)?;
        let result = service
            .search_items(attributes())
            .await
            .map_err(map_secret)?;
        if result.unlocked.len() + result.locked.len() > 1 {
            return Err(StoreError::Invalid);
        }
        if let Some(item) = result.unlocked.first() {
            item.set_secret(payload, "application/json")
                .await
                .map_err(map_secret)?;
        } else if let Some(item) = result.locked.first() {
            if !permit_interaction {
                return Err(StoreError::InteractionRequired);
            }
            item.unlock().await.map_err(map_secret)?;
            item.set_secret(payload, "application/json")
                .await
                .map_err(map_secret)?;
        } else {
            let collection = service.get_default_collection().await.map_err(map_secret)?;
            if collection.is_locked().await.map_err(map_secret)? {
                if !permit_interaction {
                    return Err(StoreError::InteractionRequired);
                }
                collection.unlock().await.map_err(map_secret)?;
            }
            if permit_interaction {
                collection
                    .create_item(LABEL, attributes(), payload, false, "application/json")
                    .await
                    .map_err(map_secret)?;
            } else {
                collection
                    .create_item_no_prompt(LABEL, attributes(), payload, false, "application/json")
                    .await
                    .map_err(map_secret)?;
            }
        }
        require_same_owner(&connection, &owner).await?;
        Ok(())
    })
}

async fn existing_owner(connection: &zbus::Connection) -> Result<OwnedUniqueName, StoreError> {
    let proxy = DBusProxy::new(connection)
        .await
        .map_err(|_| StoreError::Unavailable)?;
    let name = BusName::try_from(SERVICE_NAME).map_err(|_| StoreError::Unavailable)?;
    let owner = proxy
        .get_name_owner(name)
        .await
        .map_err(|_| StoreError::Unavailable)?;
    let owner_name = BusName::try_from(owner.as_str()).map_err(|_| StoreError::Unavailable)?;
    let owner_uid = proxy
        .get_connection_unix_user(owner_name)
        .await
        .map_err(|_| StoreError::Unavailable)?;
    if owner_uid != unsafe { geteuid() } {
        return Err(StoreError::Unavailable);
    }
    Ok(owner)
}

async fn require_same_owner(
    connection: &zbus::Connection,
    expected: &OwnedUniqueName,
) -> Result<(), StoreError> {
    let proxy = DBusProxy::new(connection)
        .await
        .map_err(|_| StoreError::Unavailable)?;
    let name = BusName::try_from(SERVICE_NAME).map_err(|_| StoreError::Unavailable)?;
    let current = proxy
        .get_name_owner(name)
        .await
        .map_err(|_| StoreError::Unavailable)?;
    if &current != expected {
        return Err(StoreError::Unavailable);
    }
    Ok(())
}

fn attributes() -> HashMap<&'static str, &'static str> {
    HashMap::from([
        ("application", "fonte"),
        ("service", "is.fonte.client-auth"),
        ("username", "customer-session-v1"),
        ("schema", "fonte.client_session.v1"),
    ])
}

fn map_secret(error: SecretError) -> StoreError {
    match error {
        SecretError::Locked | SecretError::Prompt => StoreError::InteractionRequired,
        _ => StoreError::Unavailable,
    }
}
