use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;

mod platform;

const MAX_PAYLOAD_BYTES: usize = 2_400;

#[napi]
pub const ABI_NAME: &str = "fonte.client_auth_store.native.v1";

pub struct ReadTask;

impl Task for ReadTask {
    type Output = Option<Vec<u8>>;
    type JsValue = Option<Buffer>;

    fn compute(&mut self) -> Result<Self::Output> {
        platform::read().map_err(native_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.map(Buffer::from))
    }
}

pub struct ReplaceTask {
    payload: Vec<u8>,
    permit_interaction: bool,
}

impl Task for ReplaceTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        platform::replace(&self.payload, self.permit_interaction).map_err(native_error)
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}

#[napi]
pub fn read() -> AsyncTask<ReadTask> {
    AsyncTask::new(ReadTask)
}

#[napi]
pub fn replace(payload: Buffer, permit_interaction: bool) -> Result<AsyncTask<ReplaceTask>> {
    if payload.is_empty() || payload.len() > MAX_PAYLOAD_BYTES {
        return Err(native_error(platform::StoreError::Invalid));
    }
    Ok(AsyncTask::new(ReplaceTask {
        payload: payload.to_vec(),
        permit_interaction,
    }))
}

fn native_error(error: platform::StoreError) -> Error {
    Error::new(Status::GenericFailure, error.code())
}
