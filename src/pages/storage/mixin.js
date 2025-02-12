import { mapState } from "vuex";

const BasePath = "/storage/";

export default {
  data() {
    return {
      BasePath,
      tableLoading: false,
      bucketList: [],
      domainList: JSON.parse(localStorage.domainList || "[]"),
      folderList: [],
      selected: [],
      deleting: false,
    };
  },
  computed: {
    ...mapState({
      s3: (s) => s.s3,
      searchKey: (s) => s.searchKey,
    }),
    path() {
      return decodeURIComponent(this.$route.path);
    },
    inStorage() {
      return new RegExp(BasePath).test(this.path);
    },
    inBucket() {
      return this.path == BasePath;
    },
    inFile() {
      return this.inStorage && !/\/$/.test(this.path);
    },
    inFolder() {
      return !this.inBucket && !this.inFile;
    },
    fileName() {
      const arr = this.path.split("/");
      return arr[arr.length - 1];
    },
    folderLen() {
      if (this.inFolder) return this.pathInfo.Prefix.split("/").length - 1;
      return 0;
    },
    navItems() {
      let to = BasePath;
      const items = [
        {
          text: "Storage",
          to,
          exact: true,
        },
      ];
      const arr = this.path.replace(to, "").split("/");
      for (const i in arr) {
        const text = arr[i];
        if (!text) break;
        to += text + (arr[i + 1] == "" ? "" : "/");
        items.push({
          text,
          to,
          exact: true,
        });
      }
      return items;
    },
    list() {
      let list = [];
      if (this.inBucket) {
        list = this.bucketList.map((it) => {
          it.domainInfo = this.domainList.filter(
            (d) => d.bucketName == it.name
          )[0];
          if (it.domainInfo) {
            it.domains = [
              {
                name: "Loading",
              },
            ];
            if (this.domainsMap[it.name]) {
              it.domains = [
                ...this.domainsMap[it.name],
                {
                  icon: "mdi-plus",
                  name: "Add domain",
                  to: "/domain?bucket=" + it.name,
                },
              ];
            }
          }
          return it;
        });
      } else if (this.inFolder) list = this.folderList;
      if (this.searchKey) {
        list = list.filter((it) => {
          return new RegExp(this.searchKey).test(it.name);
        });
      }
      return list;
    },
    pathInfo() {
      if (this.inBucket || !this.inStorage) return {};
      const arr = this.path.split("/").slice(2);
      const Key = arr.slice(1).join("/");
      const Bucket = arr[0];
      if (this.inFile)
        return {
          Bucket,
          Key,
        };
      return {
        Bucket,
        Prefix: Key,
        Delimiter: "/",
      };
    },
  },
  methods: {
    checkNew() {
      if (this.$route.query.new == "bucket") {
        this.addBucket();
      }
    },
    onErr(err) {
      this.$alert(err.message);
    },
    getList() {
      if (!this.s3) return;
      this.selected = [];
      if (this.inBucket) {
        this.getBuckets();
      } else if (this.inFile) {
        this.headObject();
      } else if (this.inFolder) {
        this.getObjects();
      }
    },
    async onRename(srcName) {
      try {
        const { Prefix, Key } = this.pathInfo;
        let srcKey = this.inFile ? Key : Prefix + srcName;
        console.log(this.pathInfo);
        const { value: name } = await this.$prompt("", "Rename " + srcName, {
          hideIcon: true,
          inputAttrs: {
            label: "New Name",
            counter: true,
            maxlength: 60,
            trim: true,
            rules: [
              (v) => !!(v || "").trim() || "Invalid",
              (v) => !/\//.test(v) || "/ is not allowed.",
            ],
            required: true,
          },
        });
        this.$loading();
        const reg = /[^/]+$/;
        const newKey = this.inFile ? Key.replace(reg, name) : Prefix + name;
        await this.renameObject(srcKey, newKey);
        if (this.inFile) {
          this.$router.replace(
            encodeURIComponent(this.path).replace(reg, name)
          );
        } else {
          this.getList();
        }
        await this.$sleep(500);
        this.$toast("Renamed successfully");
        this.$loading.close();
      } catch (error) {
        console.log(error);
        if (error) this.onErr(error);
      }
    },
    renameObject(srcKey, Key) {
      const { Bucket } = this.pathInfo;
      console.log(srcKey, Key);
      return new Promise((resolve, reject) => {
        this.s3.copyObject(
          {
            Bucket,
            CopySource: encodeURIComponent(Bucket + "/" + srcKey),
            Key,
          },
          (err) => {
            if (err) return reject(err);
            this.s3.deleteObject(
              {
                Bucket,
                Key: srcKey,
              },
              () => {
                resolve();
              }
            );
          }
        );
      });
    },
    headObject() {
      this.fileLoading = true;
      this.fileInfo = null;
      this.s3.headObject(this.pathInfo, (err, data) => {
        this.fileLoading = false;
        if (err) return this.onErr(err);
        this.fileInfo = {
          size: data.ContentLength,
          type: data.ContentType,
          hash: this.$utils.getCidV1(data.ETag),
          updateAt: data.LastModified,
          url: this.$endpoint + this.path.replace(BasePath, "/"),
        };
        console.log(this.fileInfo);
      });
      this.onDomain(this.pathInfo.Bucket, true);
    },
    getObjects() {
      this.tableLoading = true;
      const { Prefix } = this.pathInfo;
      const filterFn = (it) => {
        return (it.Prefix || it.Key).indexOf(this.pathInfo.Prefix) == 0;
      };
      this.s3.listObjectsV2(this.pathInfo, (err, data) => {
        this.tableLoading = false;
        if (err) return this.onErr(err);
        // console.log(data, Prefix);
        this.folderList = [
          ...(data.CommonPrefixes || []).filter(filterFn).map((it) => {
            return {
              name: it.Prefix.replace(Prefix, "").replace("/", ""),
            };
          }),
          ...(data.Contents || []).filter(filterFn).map((it) => {
            return {
              Key: it.Key,
              name: it.Key.replace(Prefix, ""),
              updateAt: it.LastModified.format(),
              size: this.$utils.getFileSize(it.Size),
              hash: this.$utils.getCidV1(it.ETag),
              isFile: true,
            };
          }),
        ];
        // console.log(this.folderList);
      });
    },
    getBuckets() {
      this.tableLoading = true;
      this.s3.listBuckets({}, (err, data) => {
        this.tableLoading = false;
        if (err) return this.onErr(err);
        this.bucketList = data.Buckets.map((it) => {
          return {
            name: it.Name,
            createAt: it.CreationDate.format(),
          };
        });
        // console.log(this.bucketList);
      });
    },
    delBucket(Bucket) {
      return new Promise((resolve, reject) => {
        this.s3.deleteBucket(
          {
            Bucket,
          },
          (err, data) => {
            if (err) reject(err);
            else resolve(data);
          }
        );
      });
    },
    async onDelFile() {
      try {
        await this.$confirm(
          "This file will be permanently deleted. Are you sure you want to continue"
        );
        const { Key } = this.pathInfo;
        this.$loading();
        await this.delObjects([
          {
            Key,
          },
        ]);
        const navItem = this.navItems[this.navItems.length - 2];
        this.$router.replace(navItem.to);
        this.$toast("Deleted successfully");
      } catch (error) {
        //
      }
      this.$loading.close();
    },
    delObjects(Objects) {
      const { Bucket } = this.pathInfo;
      const params = {
        Bucket,
        Delete: {
          Objects,
          Quiet: false,
        },
      };
      return new Promise((resolve, reject) => {
        this.s3.deleteObjects(params, (err, data) => {
          console.log(err, data);
          if (err) reject(err);
          else resolve(data);
        });
      });
    },
    async onDelete(item) {
      try {
        const arr = await this.getSelectedObjects(item);
        const suffix = arr.length > 1 ? "s" : "";
        const target = this.inBucket ? "bucket" : "file";
        let html = `The following ${target}${suffix} will be permanently deleted. Are you sure you want to continue?<ul class='mt-4 ov-a' style="max-height: 40vh">`;
        for (const row of arr) {
          html += "<li>" + row.name + "</li>";
        }
        html += "</ul>";
        await this.$confirm(html, `Remove ${target}${suffix}`);
        this.$loading();
        if (this.inBucket) {
          let errArr = [];
          for (const row of arr) {
            try {
              await this.delBucket(row.name);
            } catch (error) {
              errArr.push(`${row.name}: ${error.message}`);
            }
          }
          if (errArr.length)
            setTimeout(() => {
              this.$alert(errArr.join("<br>"));
            }, 10);
        }
        if (!this.inBucket) {
          await this.delObjects(
            arr.map((it) => {
              return { Key: it.Key };
            })
          );
        }
        this.$loading.close();
      } catch (err) {
        if (err) this.onErr(err);
        else return;
      }
      this.selected = [];
      this.getList();
      this.onUpdate();
    },
    async onUpdate(delay = 1000) {
      await this.$sleep(delay);
      this.$setState({
        noticeMsg: {
          name: "updateUsage",
        },
      });
    },
    getPath(item) {
      return this.path + item.name + (item.isFile ? "" : "/");
    },
    getViewUrl(item) {
      const { Prefix } = this.pathInfo;
      let url = this.originList[0] + "/" + Prefix + item.name;
      return url;
    },
    onView(it) {
      window.open(this.getViewUrl(it));
    },
    onStop() {},
    onRow(it) {
      const url = this.getPath(it);
      this.$router.push(url);
    },
    async getSelectedObjects(item) {
      const items = item ? [item] : this.selected;
      if (this.inBucket) return items;
      let arr = [];
      const { Prefix } = this.pathInfo;
      for (const it of items) {
        if (it.isFile) arr.push(it);
        else {
          const objArr = await this.getSubObjects(it.name);
          arr = arr.concat(
            objArr.map((sub) => {
              return {
                Key: sub.Key,
                name: sub.Key.replace(Prefix, ""),
              };
            })
          );
        }
      }
      return arr;
    },
    async getSubObjects(folder) {
      const { Bucket, Prefix } = this.pathInfo;
      const folderKey = Prefix + folder + "/";
      const params = {
        Bucket,
        Prefix: folderKey,
      };
      return new Promise((resolve, reject) => {
        this.$loading();
        this.s3.listObjectsV2(params, (err, data) => {
          this.$loading.close();
          if (err) reject(err);
          else
            resolve([
              {
                Key: folderKey,
              },
              ...(data.Contents || []),
            ]);
        });
      });
    },
  },
};
