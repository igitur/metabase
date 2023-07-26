(ns metabase.metabot.inference-ws-client
  (:require
    [clj-http.client :as http]
    [clojure.data.json :as json]
    [clojure.walk :as walk]
    [malli.core :as mc]
    [metabase.metabot.settings :as metabot-settings]))

(def inference-schema
  "The schema used to validate LLM infer input"
  (mc/schema
   [:map
    [:prompt string?]
    [:context
     [:sequential
      [:map
       [:table_name string?]
       [:table_id integer?]
       [:fields
        [:sequential
         [:map
          ;; TODO - Investigate this
          [:clause vector?]
          [:field_name string?]
          [:field_type [:or
                        keyword?
                        string?]]]]]]]]]))

(defn token-count
  "Return the token count for a given string.

  Token count is dependent on the tokenizer used in the backing service, but is
   often some variant of what GPT uses. This function can be used to precompute
   prompt, context, or other strings used in inference to ensure token budgets
  are not exceeded."
  ([endpoint input-string]
   (let [request {:method       :post
                  :url          (format "%s/tokenCount" endpoint)
                  :body         (json/write-str {:input input-string})
                  :as           :json
                  :content-type :json}
         {:keys [body status]} (http/request request)]
     (when (= 200 status)
       (:token_count body))))
  ([input-string]
   (token-count
     (metabot-settings/metabot-inference-ws-url)
     input-string)))

(defn bulk-embeddings
  "Convert the input map of {obj-str encoding} to a map of {obj-str embedding (a vector of floats)}."
  ([endpoint obj-strs->encodings]
   (let [request {:method       :post
                  :url          (format "%s/bulkEmbed" endpoint)
                  :body         (json/write-str {:input obj-strs->encodings})
                  :content-type :json}
         {:keys [body status]} (http/request request)]
     (when (= 200 status)
       (get (json/read-str body) "embeddings"))))
  ([obj-strs->encoddings]
   (bulk-embeddings
     (metabot-settings/metabot-inference-ws-url)
     obj-strs->encoddings)))

(defn keywordize-types
  [mbql]
  (walk/postwalk (fn [x]
                   (if (and (instance? clojure.lang.MapEntry x)
                            (= (key x) :base-type))
                     [(key x) (keyword (val x))]
                     x))
                 mbql))

(defn infer
  "Infer LLM output from a provided prompt and context.

  The prompt is the user prompt and the context is a machine-generated
  description of the data to be used when performing inferencing. Ideally, this
  data will be a single dataset (model or table), but multiple datasets can be
  provided. In this latter case, the expectation is that the LLM will know how
  to select the best single dataset if it doesn't know how to do joins or that
  it will select and join as desired from the provided datasets to provide the
  final answer."
  ([endpoint {:keys [prompt context] :as args}]
   {:pre [prompt context (mc/validate inference-schema args)]}
   (let [request {:method           :post
                  :url              (format "%s/infer" endpoint)
                  :body             (json/write-str {:prompt prompt :context context})
                  :as               :json
                  :content-type     :json
                  :throw-exceptions false}
         {:keys [body status]} (http/request request)]
     (when (= 200 status)
       (keywordize-types body))))
  ([prompt-data]
   (infer
    (metabot-settings/metabot-inference-ws-url)
    prompt-data)))
