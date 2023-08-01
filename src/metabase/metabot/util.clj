(ns metabase.metabot.util
  "Functions for denormalizing input, prompt input generation, and sql handing.
  If this grows much, we might want to split these out into separate nses."
  (:require
   [cheshire.core :as json]
   [clojure.core.memoize :as memoize]
   [clojure.string :as str]
   [honey.sql :as sql]
   [metabase.db.query :as mdb.query]
   [metabase.mbql.util :as mbql.u]
   [metabase.metabot.openai-client :as openai-client]
   [metabase.metabot.settings :as metabot-settings]
   [metabase.models :refer [Card Field FieldValues Table]]
   [metabase.query-processor :as qp]
   [metabase.query-processor.reducible :as qp.reducible]
   [metabase.query-processor.util.add-alias-info :as add]
   [metabase.util :as u]
   [metabase.util.log :as log]
   [toucan2.core :as t2]))

(defn supported?
  "Is metabot supported for the given database."
  [db-id]
  (let [q "SELECT 1 FROM (SELECT 1 AS ONE) AS TEST"]
    (try
      (some?
       (qp/process-query {:database db-id
                          :type     "native"
                          :native   {:query q}}))
      (catch Exception _ false))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;; Input Denormalization ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(defn normalize-name
  "Normalize model and column names to SLUG_CASE.
  The current bot responses do a terrible job of creating all kinds of SQL from a table or column name.
  Example: 'Created At', CREATED_AT, \"created at\" might all come back in the response.
  Standardization of names produces dramatically better results."
  [s]
  (some-> s
          u/upper-case-en
          (str/replace #"[^\p{Alnum}]+" " ")
          str/trim
          (str/replace #" " "_")))

(defn- add-qp-column-aliases
  "Add the aliases generated by the query processor to each results metadata field."
  [{:keys [dataset_query] :as model}]
  (let [fields           (let [qp (qp.reducible/combine-middleware
                                   (vec qp/around-middleware)
                                   (fn [query _rff _context]
                                     (add/add-alias-info
                                      (#'qp/preprocess* query))))]
                           (get-in (qp dataset_query nil nil) [:query :fields]))
        field-ref->alias (reduce
                          (fn [acc [_f _id-or-name m :as field-ref]]
                            (if-let [alias (::add/desired-alias m)]
                              (assoc acc (mbql.u/remove-namespaced-options field-ref) alias)
                              acc))
                          {}
                          fields)]
    (update model :result_metadata
            (fn [result_metadata]
              (map
               (fn [{:keys [field_ref] :as rsmd}]
                 (assoc rsmd :qp_column_name (field-ref->alias field_ref)))
               result_metadata)))))

(defn- add-inner-query
  "Produce a SELECT * over the parameterized model with columns aliased to normalized display names.
  Add this result to the input model along with the generated column aliases.
  This can be used in a CTE such that an outer query can be called on this query."
  [{:keys [id result_metadata] :as model}]
  (let [column-aliases (or
                        (some->> result_metadata
                                 (map (comp
                                       (fn [[column_name column_alias]]
                                         (cond
                                           (and column_name column_alias) (format "\"%s\" AS %s" column_name column_alias)
                                           column_alias column_alias
                                           :else nil))
                                       (juxt :qp_column_name :sql_name)))
                                 (filter identity)
                                 seq
                                 (str/join ", "))
                        "*")]
    (assoc model
           :column_aliases column-aliases
           :inner_query
           (mdb.query/format-sql
            (format "SELECT %s FROM {{#%s}} AS INNER_QUERY" column-aliases id)))))

(defn add-field-values
  "Add enumerated values (if a low-cardinality field) to a field."
  ([{:keys [id base_type] :as field} enum-cardinality-threshold]
   (let [field-vals (when
                     (and
                      (not= :type/Boolean base_type)
                      (< 0
                         (get-in field [:fingerprint :global :distinct-count] 0)
                         (inc enum-cardinality-threshold)))
                      (t2/select-one-fn :values FieldValues :field_id id))]
     (-> (cond-> field
           (seq field-vals)
           (assoc :possible_values (vec field-vals))))))
  ([field]
   (add-field-values
    field
    (metabot-settings/enum-cardinality-threshold))))

(defn- denormalize-field
  "Create a 'denormalized' version of the field which is optimized for querying
  and prompt engineering. Add in enumerated values (if a low-cardinality field),
  and remove fields unused in prompt engineering."
  ([field enum-cardinality-threshold]
   (-> field
       (add-field-values enum-cardinality-threshold)
       (dissoc :field_ref :id)))
  ([field]
   (denormalize-field
    field
    (metabot-settings/enum-cardinality-threshold))))

(defn- model->enum-ddl
  "Create the postgres enum for any item in result_metadata that has enumerated/low cardinality values."
  [{:keys [result_metadata]}]
  (into {}
        (for [{:keys [display_name sql_name possible_values]} result_metadata
              :when (seq possible_values)
              :let [ddl-str (format "create type %s_t as enum %s;"
                                    sql_name
                                    (str/join ", " (map (partial format "'%s'") possible_values)))
                    nchars  (count ddl-str)]]
          (do
            (log/tracef "Pseudo-ddl for field '%s' enumerates %s possible values contains %s chars (~%s tokens)."
                        display_name
                        (count possible_values)
                        nchars
                        (quot nchars 4))
            [sql_name ddl-str]))))

(defn- model->pseudo-ddl
  "Create an equivalent DDL for this model"
  [{model-name :name model-id :id :keys [sql_name result_metadata] :as model}]
  (log/debugf "Creating pseudo-ddl for model '%s'(%s):"
              model-name
              model-id)
  (let [enums   (model->enum-ddl model)
        [ddl] (sql/format
               {:create-table sql_name
                :with-columns (for [{:keys [sql_name base_type]} result_metadata
                                    :let [k sql_name]]
                                [k (if (enums k)
                                     (format "%s_t" k)
                                     base_type)])}
               {:dialect :ansi})
        ddl-str (str/join "\n\n" (conj (vec (vals enums)) (mdb.query/format-sql ddl)))
        nchars  (count ddl-str)]
    (log/debugf "Pseudo-ddl for model '%s'(%s) describes %s enum fields and contains %s chars (~%s tokens)."
                model-name
                model-id
                (count enums)
                nchars
                (quot nchars 4))
    ddl-str))

(defn- add-create-table-ddl [model]
  (assoc model :create_table_ddl (model->pseudo-ddl model)))

(defn- disambiguate
  "Given a seq of names that are potentially the same, provide a seq of tuples of
  original name to a non-ambiguous version of the name."
  [names]
  (let [uniquifier (metabase.mbql.util/unique-name-generator)
        [_ new-names] (reduce
                       (fn [[taken acc] n]
                         (let [candidate (uniquifier n)]
                           (if (taken candidate)
                             (recur [(conj taken candidate) acc] n)
                             [(conj taken candidate) (conj acc candidate)])))
                       [#{} []] names)]
    (map vector names new-names)))

(defn- add-sql-names
  "Add a distinct SCREAMING_SNAKE_CASE sql name to each field in the result_metadata."
  [{:keys [result_metadata] :as model}]
  (update model :result_metadata
          #(->> %
                (map (comp normalize-name :display_name))
                disambiguate
                (map (fn [rsmd [_ disambiguated-name]]
                       (assoc rsmd :sql_name disambiguated-name)) result_metadata))))

(defn denormalize-model
  "Create a 'denormalized' version of the model which is optimized for querying.
  All foreign keys are resolved as data, sql-friendly names are added, and
  an inner_query is added that is a 'plain sql' query of the data
  (with sql friendly column names) that can be used to query this model."
  [{model-name :name :as model}]
  (-> model
      add-qp-column-aliases
      add-sql-names
      add-inner-query
      (update :result_metadata #(mapv denormalize-field %))
      (assoc :sql_name (normalize-name model-name))
      add-create-table-ddl
      (dissoc :creator_id :dataset_query :table_id :collection_position)))

(defn- models->json-summary
  "Convert a map of {:models ...} to a json string summary of these models.
  This is used as a summary of the database in prompt engineering."
  [{:keys [models]}]
  (let [json-str (json/generate-string
                  {:tables
                   (for [{model-name :name model-id :id :keys [result_metadata] :as _model} models]
                     {:table-id     model-id
                      :table-name   model-name
                      :column-names (mapv :display_name result_metadata)})}
                  {:pretty true})
        nchars   (count json-str)]
    (log/debugf "Database json string descriptor contains %s chars (~%s tokens)."
                nchars
                (quot nchars 4))
    json-str))

(defn- add-model-json-summary [database]
  (assoc database :model_json_summary (models->json-summary database)))

(defn- field->pseudo-enums
  "For a field, create a potential enumerated type string.
  Returns nil if there are no field values or the cardinality is too high."
  ([{table-name :name} {field-name :name field-id :id :keys [base_type]} enum-cardinality-threshold]
   (when-let [values (and
                      (not= :type/Boolean base_type)
                      (t2/select-one-fn :values FieldValues :field_id field-id))]
     (when (<= (count values) enum-cardinality-threshold)
       (let [ddl-str (format "create type %s_%s_t as enum %s;"
                             table-name
                             field-name
                             (str/join ", " (map (partial format "'%s'") values)))
             nchars  (count ddl-str)]
         (log/debugf "Pseudo-ddl for field enum %s describes %s values and contains %s chars (~%s tokens)."
                     field-name
                     (count values)
                     nchars
                     (quot nchars 4))
         ddl-str))))
  ([table field]
   (field->pseudo-enums table field (metabot-settings/enum-cardinality-threshold))))

(defn table->pseudo-ddl
  "Create an 'approximate' ddl to represent how this table might be created as SQL.
  This can be very expensive if performed over an entire database, so memoization is recommended.
  Memoization currently happens in create-table-embedding."
  ([{table-name :name schema-name :schema table-id :id :as table} enum-cardinality-threshold]
   (let [fields       (t2/select [Field
                                  :base_type
                                  :database_required
                                  :database_type
                                  :fk_target_field_id
                                  :id
                                  :name
                                  :semantic_type]
                        :table_id table-id)
         enums        (reduce
                       (fn [acc {field-name :name :as field}]
                         (if-some [enums (field->pseudo-enums table field enum-cardinality-threshold)]
                           (assoc acc field-name enums)
                           acc))
                       {}
                       fields)
         columns      (vec
                       (for [{column-name :name :keys [database_required database_type]} fields]
                         (cond-> [column-name
                                  (if (enums column-name)
                                    (format "%s_%s_t" table-name column-name)
                                    database_type)]
                           database_required
                           (conj [:not nil]))))
         primary-keys [[(into [:primary-key]
                              (comp (filter (comp #{:type/PK} :semantic_type))
                                    (map :name))
                              fields)]]
         foreign-keys (for [{field-name :name :keys [semantic_type fk_target_field_id]} fields
                            :when (= :type/FK semantic_type)
                            :let [{fk-field-name :name fk-table-id :table_id} (t2/select-one [Field :name :table_id]
                                                                                :id fk_target_field_id)
                                  {fk-table-name :name fk-table-schema :schema} (t2/select-one [Table :name :schema]
                                                                                  :id fk-table-id)]]
                        [[:foreign-key field-name]
                         [:references (cond->>
                                       fk-table-name
                                        fk-table-schema
                                        (format "%s.%s" fk-table-schema))
                          fk-field-name]])
         create-sql   (->
                       (sql/format
                        {:create-table (keyword schema-name table-name)
                         :with-columns (reduce into columns [primary-keys foreign-keys])}
                        {:dialect :ansi :pretty true})
                       first
                       mdb.query/format-sql)
         ddl-str      (str/join "\n\n" (conj (vec (vals enums)) create-sql))
         nchars       (count ddl-str)]
     (log/debugf "Pseudo-ddl for table '%s.%s'(%s) describes %s fields, %s enums, and contains %s chars (~%s tokens)."
                 schema-name
                 table-name
                 table-id
                 (count fields)
                 (count enums)
                 nchars
                 (quot nchars 4))
     ddl-str))
  ([table]
   (table->pseudo-ddl table (metabot-settings/enum-cardinality-threshold))))

(defn denormalize-database
  "Create a 'denormalized' version of the database which is optimized for querying.
  Adds in denormalized models, sql-friendly names, and a json summary of the models
  appropriate for prompt engineering."
  [{database-name :name db_id :id :as database}]
  (let [models (t2/select Card :database_id db_id :dataset true)]
    (-> database
        (assoc :sql_name (normalize-name database-name))
        (assoc :models (mapv denormalize-model models))
        add-model-json-summary)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;; Pseudo-ddls -> Embeddings ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(defn create-table-embedding
  "Given a table (and an optional threshold to downsize the generated table enums) will compute relevant embedding
  information:
  - prompt: The prompt encoded for the table (a pseudo create table ddl)
  - embedding: A vector of doubles that encodes the prompt for embedding comparison
  - tokens: The number of tokens used to encode the prompt

  This function will recursively try to create an embedding for the table pseudo-ddl starting with the default enum
  cardinality (distinct fields at or below this count are turned into DDL enums).

  If the creation fails, will try again with the enum threshold divided by 2 until either a result is generated or the
  operation fails (returning nil). Although returning nil (vs throwing) may mask the fact that a particular table isn't
  present in the final embeddings set, this allows for queries over the rest of the database, which is preferred.
  Anything so large (the table name, column names, and base column types have to exceed the token limit) is probably
  going to be problematic and a model would be a better fit anyways.
  "
  ([{table-name :name table-id :id :as table} enum-cardinality-threshold]
   (log/debugf
    "Creating embedding for table '%s'(%s) with cardinality threshold '%s'."
    table-name
    table-id
    enum-cardinality-threshold)
   (try
     (let [ddl (table->pseudo-ddl table enum-cardinality-threshold)
           {:keys [prompt embedding tokens]} (openai-client/create-embedding ddl)]
       {:prompt    prompt
        :embedding embedding
        :tokens    tokens})
     ;; The most likely case of throwing here is that the ddl is too big.
     ;; When this happens, we'll try again with 1/2 the cardinality selected.
     ;; This will reduce the number of fields that become enumerated.
     ;; In the extreme case (= enum-cardinality-threshold 0), no enums are created.
     ;; The only way this would fail to create an embedding would be if the number
     ;; of columns were so huge that just that list of columns and types exceeded
     ;; the embedding token limit.
     (catch Exception e
       (let [{:keys [status-code message]} (ex-data e)]
         (if (and (pos? enum-cardinality-threshold)
                  (= 400 status-code))
           (let [new-enum-cardinality-threshold (quot enum-cardinality-threshold 2)]
             (log/debugf
              (str
               "Embedding creation for table '%s'(%s) with cardinality threshold '%s' failed. "
               "Retrying again with cardinality threshold '%s'.")
              table-name
              table-id
              enum-cardinality-threshold
              new-enum-cardinality-threshold)
             (create-table-embedding table new-enum-cardinality-threshold))
           ;; Instead of throwing an exception, we are going to try to recover and
           ; ignore the problematic table. This is likely a massive table with too
           ;; many columns and would be a better candidate for a model.
           (log/warnf
            (str/join
             " "
             ["Embeddings for table '%s'(%s) could not be generated."
              "It could be that this table has too many columns."
              "You might want to create a model for this table instead."
              "Error message: %s"])
            table-name
            table-id
            message))))))
  ([table]
   (create-table-embedding table (metabot-settings/enum-cardinality-threshold))))

(def memoized-create-table-embedding
  "Memoized version of create-table-embedding. Generally embeddings are small, so this is a reasonable tradeoff,
  especially when the number of tables in a db is large.
  Should probably have the same threshold as metabot-client/memoized-create-embedding."
  (memoize/ttl
   ^{::memoize/args-fn (fn [[{table-id :id} enum-cardinality-threshold]]
                         [table-id enum-cardinality-threshold])}
   create-table-embedding
    ;; 24-hour ttl
   :ttl/threshold (* 1000 60 60 24)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;; Prompt Input ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(defn- prompt-template->messages
  "Given a prompt template and a context, fill the template messages in with
  the appropriate values to create the actual submitted messages."
  [{:keys [messages]} context]
  (letfn [(update-contents [s]
            (str/replace s #"%%([^%]+)%%"
                         (fn [[_ path]]
                           (let [kw (->> (str/split path #":")
                                         (mapv (comp keyword u/lower-case-en)))]
                             (or (get-in context kw)
                                 (let [message (format "No value found in context for key path '%s'" kw)]
                                   (throw (ex-info
                                           message
                                           {:message     message
                                            :status-code 400}))))))))]
    (map (fn [prompt] (update prompt :content update-contents)) messages)))

(defn- default-prompt-templates
  "Retrieve prompt templates from the metabot-get-prompt-templates-url."
  []
  (log/info "Refreshing metabot prompt templates.")
  (let [all-templates (-> (metabot-settings/metabot-get-prompt-templates-url)
                          slurp
                          (json/parse-string keyword))]
    (-> (group-by (comp keyword :prompt_template) all-templates)
        (update-vals
         (fn [templates]
           (let [ordered (vec (sort-by :version templates))]
             {:latest    (peek ordered)
              :templates ordered}))))))

(def ^:private ^:dynamic *prompt-templates*
  "Return a map of prompt templates with keys of template type and values
  which are objects containing keys 'latest' (the latest template version)
   and 'templates' (all template versions)."
  (memoize/ttl
   default-prompt-templates
    ;; Check for updates every hour
   :ttl/threshold (* 1000 60 60)))

(defn create-prompt
  "Create a prompt by looking up the latest template for the prompt_task type
   of the context interpolating all values from the template. The returned
   value is the template object with the prompt contained in the ':prompt' key."
  [{:keys [prompt_task] :as context}]
  (if-some [{:keys [messages] :as template} (get-in (*prompt-templates*) [prompt_task :latest])]
    (let [prompt (assoc template
                        :message_templates messages
                        :messages (prompt-template->messages template context))]
      (let [nchars (count (mapcat :content messages))]
        (log/debugf "Prompt running with %s chars (~%s tokens)." nchars (quot nchars 4)))
      prompt)
    (throw
     (ex-info
      (format "No prompt inference template found for prompt type: %s" prompt_task)
      {:prompt_type prompt_task}))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;; Results Processing ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(defn select-all?
  "Is this a simple SELECT * query?"
  [sql]
  (some? (re-find #"(?i)^select\s*\*" sql)))

(defn find-result
  "Given a set of choices returned from the bot, find the first one returned by
   the supplied message-fn."
  [message-fn {:keys [choices]}]
  (or
   (some
    (fn [{:keys [message]}]
      (when-some [res (message-fn (:content message))]
        res))
    choices)
   (log/infof
    "Unable to find appropriate result for user prompt in responses:\n\t%s"
    (str/join "\n\t" (map (fn [m] (get-in m [:message :content])) choices)))))

(defn extract-sql
  "Search a provided string for a SQL block"
  [s]
  (let [sql (if (str/starts-with? (u/upper-case-en (str/trim s)) "SELECT")
              ;; This is just a raw SQL statement
              s
              ;; It looks like markdown
              (let [[_pre sql _post] (str/split s #"```(sql|SQL)?")]
                sql))]
    (mdb.query/format-sql sql)))

(defn extract-json
  "Search a provided string for a JSON block"
  [s]
  (let [json (if (and
                  (str/starts-with? s "{")
                  (str/ends-with? s "}"))
               ;; Assume this is raw json
               s
               ;; It looks like markdown
               (let [[_pre json _post] (str/split s #"```(json|JSON)?")]
                 json))]
    (json/parse-string json keyword)))

(defn bot-sql->final-sql
  "Produce the final query usable by the UI but converting the model to a CTE
  and calling the bot sql on top of it."
  [{:keys [inner_query sql_name] :as _denormalized-model} outer-query]
  (format "WITH %s AS (%s) %s" sql_name inner_query outer-query))

(defn response->viz
  "Given a response from the LLM, map this to visualization settings. Default to a table."
  [{:keys [display description visualization_settings]}]
  (let [display (keyword display)
        {:keys [x-axis y-axis]} visualization_settings]
    (case display
      (:line :bar :area :waterfall) {:display                display
                                     :name                   description
                                     :visualization_settings {:graph.dimensions [x-axis]
                                                              :graph.metrics    y-axis}}
      :scalar {:display                display
               :name                   description
               :visualization_settings {:graph.metrics    y-axis
                                        :graph.dimensions []}}
      {:display                :table
       :name                   description
       :visualization_settings {:title description}})))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;; Embedding Selection ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(defn score-prompt-embeddings
  "Given a set of 'prompt objects' (a seq of items with keys :embedding :tokens :prompt),
  and a prompt will add the :prompt and :prompt_match to each object."
  [prompt-objects user-prompt]
  (let [dot (fn dot [a b] (reduce + (map * a b)))
        {prompt-embedding :embedding} (openai-client/create-embedding user-prompt)]
    (map
     (fn [{:keys [embedding] :as prompt-object}]
       (assoc prompt-object
              :user_prompt user-prompt
              :prompt_match (dot prompt-embedding embedding)))
     prompt-objects)))

(defn generate-prompt
  "Given a set of 'prompt objects' (a seq of items with keys :embedding :tokens :prompt),
  will determine the set of prompts that best match the given prompt whose token sum
  does not exceed the token limit."
  ([prompt-objects prompt token-limit]
   (->> (score-prompt-embeddings prompt-objects prompt)
        (sort-by (comp - :prompt_match))
        (reduce
         (fn [{:keys [total-tokens] :as acc} {:keys [prompt tokens]}]
           (if (> (+ tokens total-tokens) token-limit)
             (reduced acc)
             (-> acc
                 (update :total-tokens + tokens)
                 (update :prompts conj prompt))))
         {:total-tokens 0 :prompts []})
        :prompts
        (str/join "\n")))
  ([prompt-objects prompt]
   (generate-prompt prompt-objects prompt (metabot-settings/metabot-prompt-generator-token-limit))))

(defn best-prompt-object
  "Given a set of 'prompt objects' (a seq of items with keys :embedding :tokens :prompt),
  will return the item that best matches the input prompt."
  ([prompt-objects prompt]
   (some->> (score-prompt-embeddings prompt-objects prompt)
            seq
            (apply max-key :prompt_match))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;; Inference WS/IL Methods ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(defn model->context
  "Convert a model to a 'context', the representation used to tell the LLM
  about what is stored in the model.

  The context contains the table name and id as well as field names and ids.
  This is what the LLMs are currently trained on, so modifying this context
  will likely require retraining as well. We probably _should_ remove ids since
  they add no value when we replace them in the prompts and we should add model
  descriptions for fields."
  [{model-name :name model-id :id :keys [result_metadata]}]
  {:table_name model-name
   :table_id   model-id
   ;; todo: aggregations may behave differently (ie referenced by position not name)
   :fields     (for [{col-name :name field-name :display_name :as field} result_metadata
                     :let [typee (or (:effective_type field) (:base_type field))]]
                 {:clause [:field col-name {:base-type (str (namespace typee) "/" (name typee))}]
                  :field_name field-name
                  :field_type typee})})

(defn model->summary
  "Create a summary description appropriate for embedding.

  The embeddings created here will be compared to the embedding for the prompt
  and the closest match(es) will be used for inferencing. This summary should
  contain terms that relate well to the user prompt. The summary should be
  word-oriented rather than data oriented (provide a sentence, not json) as the
  comparison will be sentence to sentence."
  [{model-name :name model-description :description :keys [result_metadata]}]
  (let [fields-str (str/join "," (map :display_name result_metadata))]
    (if (seq model-description)
      (format "%s: %s: %s" model-name model-description fields-str)
      (format "%s: %s" model-name fields-str))))
