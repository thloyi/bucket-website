import Vue from "vue";
import Axios from "axios";
import AsyncLock from "async-lock";

const inDev = /xyz/.test(process.env.VUE_APP_BASE_URL);
Vue.prototype.$inDev = inDev;

const baseURL = process.env.VUE_APP_BASE_URL;

export const endpoint = inDev
  ? "https://s3gw.foreverland.xyz"
  : "https://endpoint.4everland.co";
const authApi = inDev
  ? "https://auth.foreverland.xyz"
  : "https://oauth.4everland.org";

Vue.prototype.$endpoint = endpoint;

const http = Axios.create({
  baseURL,
});

const RefreshPath = "/refresh";
const RefreshLockKey = "refresh";
const lock = new AsyncLock({ timeout: 5000 });
http.interceptors.request.use(
  async (config) => {
    let token = "";
    if (config.url != RefreshPath) {
      await lock
        .acquire(RefreshLockKey, async () => {
          token = localStorage.token;
          let { accessTokenExpireAt, refreshToken } = JSON.parse(
            localStorage.authData || "{}"
          );
          if (token && Date.now() + 3600 * 1e3 >= accessTokenExpireAt) {
            const { data } = await http.post(
              RefreshPath,
              {
                refreshToken,
              },
              {
                params: {
                  _auth: 1,
                },
                headers: {
                  Authorization: "Bearer " + token,
                },
              }
            );
            localStorage.authData = JSON.stringify(data);
            token = data.accessToken;
            localStorage.token = token;
          }
        })
        .then(() => {});
    } else {
      token = localStorage.token;
    }

    const params = (config.params = config.params || {});
    if (params._auth && !/^http/.test(config.url)) {
      config.url = authApi + config.url;
      delete params._auth;
    }
    if (token && config.url != RefreshPath) {
      config.headers.common["Authorization"] = token;
    }
    return config;
  },
  (error) => {
    console.log(error);
    return Promise.reject(error);
  }
);

function goLogin() {
  localStorage.token = "";
  delete localStorage.userInfo;
  if (location.hash != "#/login") {
    localStorage.loginTo = location.hash;
    location.href = "index.html/#/login";
    // console.log("logout");
  }
}

http.interceptors.response.use(
  (res) => {
    const data = res.data;
    if (typeof data == "object" && data && "code" in data) {
      if (data.code != 200) {
        let msg = data.message || `${data.code} error`;
        Vue.prototype.$loading.close();
        // console.log(msg)
        if (data.code < 1e4) {
          goLogin();
        }
        const error = new Error(msg);
        error.code = data.code;
        throw error;
      }
      if ("data" in data) {
        return data;
      }
    }
    return res;
  },
  (error) => {
    const { config = {}, data = {}, status, statusText } = error.response || {};
    console.log(error, status, statusText);
    let msg =
      data.message ||
      statusText ||
      (status ? `${config.url}：${status}` : error.message);
    if (msg == "Network Error") {
      msg =
        "A network error has occurred. Please check your connections and try again.";
    }
    if (status == 401) {
      goLogin();
    } else if (msg) {
      setTimeout(() => {
        Vue.prototype.$alert(msg).then(() => {
          if (msg == "Request aborted") {
            location.reload();
          }
        });
      }, 10);
    }
    error.code = data.code;
    return Promise.reject(error);
  }
);

Vue.prototype.$http = http;

export default http;
